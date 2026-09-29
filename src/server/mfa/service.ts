import { generateSecret, verifyTotp } from "@/lib/security/totp";
import { generateRecoveryCodes } from "@/lib/security/recovery";
import { verifyPassword } from "@/lib/security/password";
import type { RateResult } from "@/lib/security/rate-limit";
import { ValidationError } from "@/server/errors";

export interface MfaRepo {
  state(userId: string): Promise<{ hasSecret: boolean; enabled: boolean }>;
  pendingSecret(userId: string): Promise<string | null>;
  setPendingSecret(userId: string, secretPlain: string): Promise<void>;
  enable(userId: string): Promise<void>;
  disable(userId: string): Promise<void>;
  replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void>;
  passwordHash(userId: string): Promise<string | null>;
  revokeAllSessions(userId: string): Promise<void>;
  audit(e: { action: string; actorId: string }): Promise<void>;
}
type Limiter = { hit(key: string, limit: number, windowMs: number): RateResult | Promise<RateResult> };

const ISSUER = "SmartDoctorAid";
const WINDOW = 15 * 60_000, MAX_ATTEMPTS = 5;

export function createMfaService(repo: MfaRepo, limiter: Limiter) {
  async function throttle(kind: string, userId: string) {
    if (!(await limiter.hit(`mfa-${kind}:${userId}`, MAX_ATTEMPTS, WINDOW)).allowed) throw new ValidationError("Too many attempts. Try again in a few minutes.");
  }
  return {
    state: (userId: string) => repo.state(userId),

    async start(userId: string, accountLabel: string) {
      if ((await repo.state(userId)).enabled) throw new ValidationError("MFA is already enabled");
      const secret = generateSecret();
      await repo.setPendingSecret(userId, secret);
      const otpauthUri = `otpauth://totp/${ISSUER}:${encodeURIComponent(accountLabel)}?secret=${secret}&issuer=${ISSUER}`;
      return { secret, otpauthUri };
    },

    /** Enabling requires proving the authenticator works. Sessions are revoked so the user signs in again WITH the second factor. */
    async confirm(userId: string, code: string) {
      await throttle("confirm", userId);
      const secret = await repo.pendingSecret(userId);
      if (!secret) throw new ValidationError("Start MFA setup first");
      if (!verifyTotp(secret, code, Date.now())) throw new ValidationError("Invalid verification code");
      const { plain, hashes } = generateRecoveryCodes(8);
      await repo.enable(userId);
      await repo.replaceRecoveryCodes(userId, hashes);
      await repo.revokeAllSessions(userId);
      await repo.audit({ action: "mfa.enabled", actorId: userId });
      return { recoveryCodes: plain }; // shown once; only hashes are stored
    },

    async disable(userId: string, password: string, code: string, opts: { privileged?: boolean } = {}) {
      if (opts.privileged) throw new ValidationError("MFA is required for your role and cannot be disabled");
      await throttle("disable", userId);
      const [hash, secret] = [await repo.passwordHash(userId), await repo.pendingSecret(userId)];
      if (!hash || !(await verifyPassword(password, hash)) || !secret || !verifyTotp(secret, code, Date.now())) throw new ValidationError("Password or code is incorrect");
      await repo.disable(userId);
      await repo.revokeAllSessions(userId);
      await repo.audit({ action: "mfa.disabled", actorId: userId });
    },
  };
}
