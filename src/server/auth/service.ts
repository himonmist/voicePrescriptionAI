import { hashPassword, verifyPassword, validatePasswordPolicy } from "@/lib/security/password";
import { signSession, verifySession } from "@/lib/security/session";
import type { RateResult } from "@/lib/security/rate-limit";
import type { Actor, Role } from "@/lib/security/rbac";
import { verifyTotp } from "@/lib/security/totp";
import { loginSchema, registerDoctorSchema, registerPatientSchema } from "@/lib/validation/auth";

export interface UserRow { id: string; email: string; passwordHash: string; failedLogins: number; lockedUntil: Date | null; disabledAt: Date | null }
export interface AuthRepo {
  findUserByEmail(email: string): Promise<UserRow | null>;
  createUser(u: { email: string; fullName: string; phone: string; passwordHash: string; roles: Role[] }): Promise<UserRow>;
  createDoctorProfile(p: { userId: string; bmdcNumber: string; specialty: string }): Promise<void>;
  recordFailedLogin(userId: string): Promise<number>;
  resetFailedLogins(userId: string): Promise<void>;
  createSession(s: { userId: string; expiresAt: Date; ip?: string }): Promise<string>;
  isSessionActive(sessionId: string): Promise<boolean>;
  revokeSession(sessionId: string): Promise<void>;
  rolesFor(userId: string): Promise<Role[]>;
  /** Decrypted TOTP secret if MFA is enrolled, else null. */
  mfaSecretFor(userId: string): Promise<string | null>;
  audit(e: { action: string; actorId?: string | null; ip?: string; metadata?: Record<string, unknown> }): Promise<void>;
}

type Fail = { ok: false; status: number; error: string; mfaRequired?: boolean };
type LoginOk = { ok: true; token: string; expiresAt: Date; roles: Role[] };
const GENERIC = { ok: false, status: 401, error: "Invalid email or password" } as const;
const SESSION_TTL_S = 60 * 60 * 8;
const LOGIN_LIMIT = { max: 10, windowMs: 15 * 60_000 };

export function createAuthService(repo: AuthRepo, limiter: { hit(key: string, limit: number, windowMs: number): RateResult | Promise<RateResult> }) {
  async function register(base: { fullName: string; email: string; phone: string; password: string }, roles: Role[], after?: (userId: string) => Promise<void>): Promise<{ ok: true; userId: string } | Fail> {
    const pol = validatePasswordPolicy(base.password);
    if (!pol.ok) return { ok: false, status: 422, error: pol.reason! };
    if (await repo.findUserByEmail(base.email)) return { ok: false, status: 409, error: "Unable to register with these details" };
    const user = await repo.createUser({ email: base.email, fullName: base.fullName, phone: base.phone, passwordHash: await hashPassword(base.password), roles });
    await after?.(user.id);
    await repo.audit({ action: "user.registered", actorId: user.id, metadata: { roles } });
    return { ok: true, userId: user.id };
  }

  return {
    registerPatient(input: unknown) {
      const p = registerPatientSchema.safeParse(input);
      if (!p.success) return Promise.resolve<Fail>({ ok: false, status: 422, error: "Invalid input" });
      return register(p.data, ["patient"]);
    },
    registerDoctor(input: unknown) {
      const p = registerDoctorSchema.safeParse(input);
      if (!p.success) return Promise.resolve<Fail>({ ok: false, status: 422, error: "Invalid input" });
      return register(p.data, ["doctor"], (userId) => repo.createDoctorProfile({ userId, bmdcNumber: p.data.bmdcNumber, specialty: p.data.specialty }));
    },

    async login(input: unknown, ctx: { ip: string }): Promise<LoginOk | Fail> {
      const rl = await limiter.hit(`login:${ctx.ip}`, LOGIN_LIMIT.max, LOGIN_LIMIT.windowMs);
      if (!rl.allowed) return { ok: false, status: 429, error: "Too many attempts. Try again later." };
      const p = loginSchema.safeParse(input);
      if (!p.success) return { ...GENERIC };
      const user = await repo.findUserByEmail(p.data.email);
      // Always run a hash verification to keep timing uniform for unknown users.
      const dummy = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA";
      const valid = await verifyPassword(p.data.password, user?.passwordHash ?? dummy);
      if (!user || user.disabledAt) return { ...GENERIC };
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        await repo.audit({ action: "auth.login_blocked_locked", actorId: user.id, ip: ctx.ip });
        return { ...GENERIC };
      }
      if (!valid) {
        await repo.recordFailedLogin(user.id);
        await repo.audit({ action: "auth.login_failed", actorId: user.id, ip: ctx.ip });
        return { ...GENERIC };
      }
      const mfaSecret = await repo.mfaSecretFor(user.id);
      if (mfaSecret) {
        // Reached only after the password is proven, so this does not leak MFA status.
        if (!p.data.totp) return { ok: false, status: 401, error: "Verification code required", mfaRequired: true };
        if (!verifyTotp(mfaSecret, p.data.totp, Date.now())) {
          await repo.recordFailedLogin(user.id);
          await repo.audit({ action: "auth.mfa_failed", actorId: user.id, ip: ctx.ip });
          return { ...GENERIC };
        }
      }
      await repo.resetFailedLogins(user.id);
      const roles = await repo.rolesFor(user.id);
      const expiresAt = new Date(Date.now() + SESSION_TTL_S * 1000);
      const sid = await repo.createSession({ userId: user.id, expiresAt, ip: ctx.ip });
      const token = await signSession({ sub: user.id, roles, orgId: null, sid }, SESSION_TTL_S);
      await repo.audit({ action: "auth.login", actorId: user.id, ip: ctx.ip });
      return { ok: true, token, expiresAt, roles };
    },

    /** Verifies signature AND that the server-side session is still active (revocation). */
    async authenticate(token: string): Promise<Actor | null> {
      const c = await verifySession(token);
      if (!c || !(await repo.isSessionActive(c.sid))) return null;
      return { userId: c.sub, roles: c.roles, orgId: c.orgId };
    },

    async logout(token: string) {
      const c = await verifySession(token);
      if (!c) return;
      await repo.revokeSession(c.sid);
      await repo.audit({ action: "auth.logout", actorId: c.sub });
    },
  };
}
