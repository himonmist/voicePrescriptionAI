import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { createAuthService, type AuthRepo, type UserRow } from "@/server/auth/service";
import { hashPassword } from "@/lib/security/password";
import { MemoryRateLimiter } from "@/lib/security/rate-limit";
import type { Role } from "@/lib/security/rbac";

beforeAll(() => { process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-32+"; });

function fakeRepo() {
  const users: (UserRow & { roles: Role[] })[] = [];
  const sessions = new Map<string, { userId: string; revoked: boolean; expiresAt: Date }>();
  const audit: { action: string; actorId?: string | null }[] = [];
  const doctors: { userId: string; status: string }[] = [];
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
    async audit(e) { audit.push(e); },
  };
  return { repo, users, doctors, audit, sessions };
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
});
