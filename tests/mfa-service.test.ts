import { describe, it, expect, beforeEach } from "vitest";
import { createMfaService, type MfaRepo } from "@/server/mfa/service";
import { generateTotp } from "@/lib/security/totp";
import { hashPassword } from "@/lib/security/password";
import { MemoryRateLimiter } from "@/lib/security/rate-limit";
import { hashRecoveryCode } from "@/lib/security/recovery";
import { ValidationError } from "@/server/errors";

async function fake() {
  const st = { secret: null as string | null, enabled: false, codes: new Map<string, boolean>(), audit: [] as string[], sessionsRevoked: 0, pw: await hashPassword("Correct-Horse-9!") };
  const repo: MfaRepo = {
    async state() { return { hasSecret: !!st.secret, enabled: st.enabled }; },
    async pendingSecret() { return st.secret; },
    async setPendingSecret(_u, s) { st.secret = s; st.enabled = false; },
    async enable() { st.enabled = true; },
    async disable() { st.secret = null; st.enabled = false; st.codes.clear(); },
    async replaceRecoveryCodes(_u, h) { st.codes = new Map(h.map((x) => [x, false])); },
    async passwordHash() { return st.pw; },
    async revokeAllSessions() { st.sessionsRevoked++; },
    async audit(e) { st.audit.push(e.action); },
  };
  return { st, repo };
}

describe("mfa enrolment", () => {
  let f: Awaited<ReturnType<typeof fake>>; let svc: ReturnType<typeof createMfaService>;
  beforeEach(async () => { f = await fake(); svc = createMfaService(f.repo, new MemoryRateLimiter()); });

  it("start returns a secret + otpauth URI, but MFA is not enabled until a valid code is confirmed", async () => {
    const r = await svc.start("u1", "dr@x.com");
    expect(r.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(r.otpauthUri).toMatch(/^otpauth:\/\/totp\/SmartDoctorAid:dr%40x\.com\?secret=.+&issuer=SmartDoctorAid/);
    expect(f.st.enabled).toBe(false);
  });
  it("rejects a wrong code and does not enable", async () => {
    await svc.start("u1", "dr@x.com");
    await expect(svc.confirm("u1", "000000")).rejects.toThrow(ValidationError);
    expect(f.st.enabled).toBe(false);
  });
  it("confirm with a valid code enables MFA, returns one-time recovery codes (stored hashed), revokes sessions and audits", async () => {
    const { secret } = await svc.start("u1", "dr@x.com");
    const { recoveryCodes } = await svc.confirm("u1", generateTotp(secret, Date.now()));
    expect(f.st.enabled).toBe(true);
    expect(recoveryCodes).toHaveLength(8);
    expect([...f.st.codes.keys()]).toEqual(recoveryCodes.map(hashRecoveryCode));
    expect(f.st.sessionsRevoked).toBe(1);
    expect(f.st.audit).toContain("mfa.enabled");
  });
  it("cannot confirm without starting; cannot restart once enabled", async () => {
    await expect(svc.confirm("u1", "123456")).rejects.toThrow(ValidationError);
    const { secret } = await svc.start("u1", "a@b.c");
    await svc.confirm("u1", generateTotp(secret, Date.now()));
    await expect(svc.start("u1", "a@b.c")).rejects.toThrow(/already/i);
  });
  it("throttles confirmation attempts (brute-force protection)", async () => {
    await svc.start("u1", "a@b.c");
    for (let i = 0; i < 5; i++) await svc.confirm("u1", "000000").catch(() => {});
    await expect(svc.confirm("u1", "000000")).rejects.toThrow(/too many/i);
  });
  it("disable requires BOTH the password and a valid current code, then wipes secret + recovery codes", async () => {
    const { secret } = await svc.start("u1", "a@b.c");
    await svc.confirm("u1", generateTotp(secret, Date.now()));
    await expect(svc.disable("u1", "wrong", generateTotp(secret, Date.now()))).rejects.toThrow(ValidationError);
    await expect(svc.disable("u1", "Correct-Horse-9!", "000000")).rejects.toThrow(ValidationError);
    await svc.disable("u1", "Correct-Horse-9!", generateTotp(secret, Date.now()));
    expect(f.st.enabled).toBe(false); expect(f.st.codes.size).toBe(0);
    expect(f.st.audit).toContain("mfa.disabled");
  });
  it("privileged roles may not disable MFA at all", async () => {
    const { secret } = await svc.start("u1", "a@b.c");
    await svc.confirm("u1", generateTotp(secret, Date.now()));
    await expect(svc.disable("u1", "Correct-Horse-9!", generateTotp(secret, Date.now()), { privileged: true })).rejects.toThrow(/required for your role/i);
  });
});
