import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { createAuthService, type AuthRepo, type UserRow } from "@/server/auth/service";
import { hashPassword } from "@/lib/security/password";
import { MemoryRateLimiter } from "@/lib/security/rate-limit";
import type { Role } from "@/lib/security/rbac";
import { generateSecret, generateTotp } from "@/lib/security/totp";
import { hashRecoveryCode } from "@/lib/security/recovery";

beforeAll(() => { process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-32+"; });

function fakeRepo() {
  const users: (UserRow & { roles: Role[] })[] = [];
  const sessions = new Map<string, { userId: string; revoked: boolean; expiresAt: Date }>();
  const audit: { action: string; actorId?: string | null }[] = [];
  const doctors: { userId: string; status: string }[] = [];
  const mfa = new Map<string, string>();
  const orgs = new Map<string, string>();
  const recovery = new Map<string, boolean>();
  const repo: AuthRepo = {
    async findUserByEmail(e) { return users.find((u) => u.email === e) ?? null; },
    async createUser(u) { const row = { ...u, id: `u${users.length + 1}`, failedLogins: 0, lockedUntil: null, disabledAt: null, roles: u.roles }; users.push(row); return row; },
    async createDoctorProfile(p) { doctors.push({ userId: p.userId, status: "registered" }); },
    async recordFailedLogin(id) { const u = users.find((x) => x.id === id)!; u.failedLogins++; if (u.failedLogins >= 5) u.lockedUntil = new Date(Date.now() + 15 * 60_000); return u.failedLogins; },
    async resetFailedLogins(id) { const u = users.find((x) => x.id === id)!; u.failedLogins = 0; u.lockedUntil = null; },
    async createSession(s) { const id = `s${sessions.size + 1}`; sessions.set(id, { userId: s.userId, revoked: false, expiresAt: s.expiresAt }); return id; },
    async isSessionActive(id) { const s = sessions.get(id); return !!s && !s.revoked && s.expiresAt > new Date(); },
    async revokeSession(id) { const s = sessions.get(id); if (s) s.revoked = true; },
    async rolesFor(id) { return users.find((u) => u.id === id)!.roles; },
    async consumeRecoveryCode(id, hash) { const k = `${id}:${hash}`; if (!recovery.has(k) || recovery.get(k)) return false; recovery.set(k, true); return true; },
    async primaryOrgFor(id) { return orgs.get(id) ?? null; },
    async mfaSecretFor(id) { return mfa.get(id) ?? null; },
    async audit(e) { audit.push(e); },
  };
  return { repo, users, doctors, audit, sessions, mfa, orgs, recovery };
}

describe("auth service", () => {
  let f: ReturnType<typeof fakeRepo>; let svc: ReturnType<typeof createAuthService>;
  beforeEach(() => { f = fakeRepo(); svc = createAuthService(f.repo, new MemoryRateLimiter()); });

  it("registers a patient with patient role only and audits", async () => {
    const r = await svc.registerPatient({ fullName: "Test Patient", email: "P@x.com", phone: "01712345678", password: "Correct-Horse-9!" });
    expect(r.ok).toBe(true);
    expect(f.users[0].roles).toEqual(["patient"]);
    expect(f.users[0].passwordHash).not.toContain("Correct");
    expect(f.audit.map((a) => a.action)).toContain("user.registered");
  });

  it("registers a doctor in 'registered' status — never approved", async () => {
    const r = await svc.registerDoctor({ fullName: "Dr T", email: "d@x.com", phone: "01712345678", password: "Correct-Horse-9!", bmdcNumber: "A-12345", specialty: "Cardiology" });
    expect(r.ok).toBe(true);
    expect(f.doctors[0].status).toBe("registered");
    expect(f.users[0].roles).toEqual(["doctor"]);
  });

  it("rejects duplicate email without leaking which field", async () => {
    const input = { fullName: "A B", email: "d@x.com", phone: "01712345678", password: "Correct-Horse-9!" };
    await svc.registerPatient(input);
    const r = await svc.registerPatient(input);
    expect(r.ok).toBe(false);
  });

  it("rejects weak passwords at registration", async () => {
    const r = await svc.registerPatient({ fullName: "A B", email: "w@x.com", phone: "01712345678", password: "aaaaaaaaaaaaaaaa" });
    expect(r.ok).toBe(false);
  });

  it("logs in with correct password and issues a verifiable token", async () => {
    await svc.registerPatient({ fullName: "A B", email: "l@x.com", phone: "01712345678", password: "Correct-Horse-9!" });
    const r = await svc.login({ email: "L@x.com", password: "Correct-Horse-9!" }, { ip: "1.1.1.1" });
    expect(r.ok && r.token).toBeTruthy();
  });

  it("uses identical error for unknown user and wrong password", async () => {
    await svc.registerPatient({ fullName: "A B", email: "l@x.com", phone: "01712345678", password: "Correct-Horse-9!" });
    const a = await svc.login({ email: "nobody@x.com", password: "whatever-pass-1A" }, { ip: "1" });
    const b = await svc.login({ email: "l@x.com", password: "wrong-pass-1AAAA" }, { ip: "1" });
    expect(a).toEqual(b);
  });

  it("locks the account after 5 failures even with the right password", async () => {
    await svc.registerPatient({ fullName: "A B", email: "l@x.com", phone: "01712345678", password: "Correct-Horse-9!" });
    for (let i = 0; i < 5; i++) await svc.login({ email: "l@x.com", password: "bad-password-1A" }, { ip: `ip${i}` });
    const r = await svc.login({ email: "l@x.com", password: "Correct-Horse-9!" }, { ip: "ipX" });
    expect(r.ok).toBe(false);
  });

  it("rate limits login attempts per IP", async () => {
    let last: any;
    for (let i = 0; i < 12; i++) last = await svc.login({ email: `u${i}@x.com`, password: "whatever-pass-1A" }, { ip: "9.9.9.9" });
    expect(last.ok).toBe(false);
    expect(last.status).toBe(429);
  });

  it("logout revokes the server-side session", async () => {
    await svc.registerPatient({ fullName: "A B", email: "l@x.com", phone: "01712345678", password: "Correct-Horse-9!" });
    const r = await svc.login({ email: "l@x.com", password: "Correct-Horse-9!" }, { ip: "1" });
    if (!r.ok) throw new Error("login failed");
    expect(await svc.authenticate(r.token)).not.toBeNull();
    await svc.logout(r.token);
    expect(await svc.authenticate(r.token)).toBeNull();
  });

  it("puts the user's organization into the session actor (tenant scoping)", async () => {
    await svc.registerPatient({ fullName: "A B", email: "o@x.com", phone: "01712345678", password: "Correct-Horse-9!" });
    f.orgs.set("u1", "org-123");
    const r = await svc.login({ email: "o@x.com", password: "Correct-Horse-9!" }, { ip: "1" });
    if (!r.ok) throw new Error("login failed");
    expect((await svc.authenticate(r.token))?.orgId).toBe("org-123");
  });

  describe("privileged roles must enrol in MFA", () => {
    async function adminLogin(mfaEnrolled: boolean) {
      await svc.registerPatient({ fullName: "A B", email: "adm@x.com", phone: "01712345678", password: "Correct-Horse-9!" });
      f.users[0].roles = ["super_admin"];
      if (mfaEnrolled) f.mfa.set("u1", generateSecret());
      return svc.login({ email: "adm@x.com", password: "Correct-Horse-9!", totp: mfaEnrolled ? generateTotp([...f.mfa.values()][0], Date.now()) : undefined }, { ip: "1" });
    }
    it("admin without MFA gets a restricted (mfaPending) session", async () => {
      const r = await adminLogin(false); if (!r.ok) throw new Error("login failed");
      expect((await svc.authenticate(r.token))?.mfaPending).toBe(true);
    });
    it("admin with MFA gets a full session", async () => {
      const r = await adminLogin(true); if (!r.ok) throw new Error("login failed");
      expect((await svc.authenticate(r.token))?.mfaPending).toBeFalsy();
    });
    describe("test-account MFA bypass (staging only)", () => {
      const test = new Set<string>();
      const mk = (bypass: boolean) => { svc = createAuthService({ ...f.repo, isTestAccount: async (id) => test.has(id) }, new MemoryRateLimiter(), { allowTestMfaBypass: bypass }); };
      const login = async () => { await svc.registerPatient({ fullName: "A B", email: "adm@x.com", phone: "01712345678", password: "Correct-Horse-9!" }); f.users[0].roles = ["super_admin"]; const r = await svc.login({ email: "adm@x.com", password: "Correct-Horse-9!" }, { ip: "1" }); if (!r.ok) throw new Error("x"); return svc.authenticate(r.token); };
      it("flagged test admin skips MFA enrolment ONLY when the flag is on", async () => { test.add("u1"); mk(true); expect((await login())?.mfaPending).toBeFalsy(); });
      it("flag off: test admin is still restricted", async () => { test.add("u1"); mk(false); expect((await login())?.mfaPending).toBe(true); });
      it("flag on: a REAL (unflagged) admin is still restricted", async () => { test.clear(); mk(true); expect((await login())?.mfaPending).toBe(true); });
    });
    it("regular users without MFA are not restricted", async () => {
      await svc.registerPatient({ fullName: "A B", email: "p@x.com", phone: "01712345678", password: "Correct-Horse-9!" });
      const r = await svc.login({ email: "p@x.com", password: "Correct-Horse-9!" }, { ip: "1" }); if (!r.ok) throw new Error("x");
      expect((await svc.authenticate(r.token))?.mfaPending).toBeFalsy();
    });
  });

  describe("MFA recovery codes", () => {
    it("a recovery code logs in once and cannot be reused", async () => {
      await svc.registerPatient({ fullName: "A B", email: "m@x.com", phone: "01712345678", password: "Correct-Horse-9!" });
      f.mfa.set("u1", generateSecret()); f.recovery.set(`u1:${hashRecoveryCode("abcde-fghjk")}`, false);
      const login = () => svc.login({ email: "m@x.com", password: "Correct-Horse-9!", recoveryCode: "ABCDE-fghjk" }, { ip: "1" });
      expect((await login()).ok).toBe(true);
      expect((await login()).ok).toBe(false);
    });
    it("a recovery code alone (wrong password) never works", async () => {
      await svc.registerPatient({ fullName: "A B", email: "m@x.com", phone: "01712345678", password: "Correct-Horse-9!" });
      f.mfa.set("u1", generateSecret()); f.recovery.set(`u1:${hashRecoveryCode("abcde-fghjk")}`, false);
      const r = await svc.login({ email: "m@x.com", password: "wrong-Pass-1AAAA", recoveryCode: "abcde-fghjk" }, { ip: "1" });
      expect(r.ok).toBe(false);
      expect(f.recovery.get(`u1:${hashRecoveryCode("abcde-fghjk")}`)).toBe(false);
    });
  });

  describe("MFA", () => {
    it("requires a TOTP code when MFA is enrolled", async () => {
      await svc.registerPatient({ fullName: "A B", email: "m@x.com", phone: "01712345678", password: "Correct-Horse-9!" });
      const secret = generateSecret(); f.mfa.set("u1", secret);
      const no = await svc.login({ email: "m@x.com", password: "Correct-Horse-9!" }, { ip: "1" });
      expect(no).toMatchObject({ ok: false, mfaRequired: true });
      const bad = await svc.login({ email: "m@x.com", password: "Correct-Horse-9!", totp: "000000" }, { ip: "1" });
      expect(bad.ok).toBe(false);
      const good = await svc.login({ email: "m@x.com", password: "Correct-Horse-9!", totp: generateTotp(secret, Date.now()) }, { ip: "1" });
      expect(good.ok).toBe(true);
    });
    it("does not reveal MFA status for wrong passwords", async () => {
      await svc.registerPatient({ fullName: "A B", email: "m@x.com", phone: "01712345678", password: "Correct-Horse-9!" });
      f.mfa.set("u1", generateSecret());
      const r = await svc.login({ email: "m@x.com", password: "wrong-pass-1AAA" }, { ip: "1" });
      expect(r).toMatchObject({ ok: false, status: 401 });
      expect((r as any).mfaRequired).toBeUndefined();
    });
  });
});
