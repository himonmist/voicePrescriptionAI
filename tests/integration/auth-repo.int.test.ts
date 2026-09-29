import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { hasDb, setupTestDb, resetData } from "./db";
import { drizzleAuthRepo } from "@/server/auth/drizzle-repo";
import { createAuthService } from "@/server/auth/service";
import { makeDbRateLimiter } from "@/lib/security/rate-limit-db";
import { auditEvents, users } from "@/db/schema";

describe.skipIf(!hasDb)("auth repo (real Postgres)", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => { process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-32+"; ctx = await setupTestDb(); });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => { await resetData(ctx.db); });

  const patient = { fullName: "Test Patient", email: "p@example.com", phone: "01712345678", password: "Correct-Horse-9!" };

  it("registers a user with roles and enforces unique email at DB level", async () => {
    const repo = drizzleAuthRepo(ctx.db);
    await repo.createUser({ email: "a@x.com", fullName: "A", phone: "01712345678", passwordHash: "h", roles: ["patient"] });
    await expect(repo.createUser({ email: "a@x.com", fullName: "B", phone: "01712345679", passwordHash: "h", roles: ["patient"] })).rejects.toThrow();
    const u = await repo.findUserByEmail("a@x.com");
    expect(await repo.rolesFor(u!.id)).toEqual(["patient"]);
  });

  it("rolls back user creation when role insert fails (transactional)", async () => {
    const repo = drizzleAuthRepo(ctx.db);
    await expect(repo.createUser({ email: "t@x.com", fullName: "T", phone: "01712345678", passwordHash: "h", roles: ["patient", "patient"] })).rejects.toThrow();
    expect(await repo.findUserByEmail("t@x.com")).toBeNull();
  });

  it("full register → login → authenticate → logout → revoked", async () => {
    const svc = createAuthService(drizzleAuthRepo(ctx.db), makeDbRateLimiter(ctx.db));
    expect((await svc.registerPatient(patient)).ok).toBe(true);
    const r = await svc.login({ email: patient.email, password: patient.password }, { ip: "1.2.3.4" });
    if (!r.ok) throw new Error("login failed");
    const actor = await svc.authenticate(r.token);
    expect(actor?.roles).toEqual(["patient"]);
    await svc.logout(r.token);
    expect(await svc.authenticate(r.token)).toBeNull();
  });

  it("locks the account after 5 failures (atomic counter) and persists audit events", async () => {
    const svc = createAuthService(drizzleAuthRepo(ctx.db), makeDbRateLimiter(ctx.db));
    await svc.registerPatient(patient);
    for (let i = 0; i < 5; i++) await svc.login({ email: patient.email, password: "bad-password-1A" }, { ip: `10.0.0.${i}` });
    const [u] = await ctx.db.select().from(users);
    expect(u.failedLogins).toBe(5);
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    const ok = await svc.login({ email: patient.email, password: patient.password }, { ip: "10.0.0.99" });
    expect(ok.ok).toBe(false);
    const actions = (await ctx.db.select().from(auditEvents)).map((a) => a.action);
    expect(actions).toContain("auth.login_failed");
    expect(actions).toContain("auth.login_blocked_locked");
  });

  it("concurrent failed logins do not lose increments", async () => {
    const repo = drizzleAuthRepo(ctx.db);
    const u = await repo.createUser({ email: "c@x.com", fullName: "C", phone: "01712345678", passwordHash: "h", roles: ["patient"] });
    await Promise.all(Array.from({ length: 4 }, () => repo.recordFailedLogin(u.id)));
    const [row] = await ctx.db.select().from(users);
    expect(row.failedLogins).toBe(4);
  });

  it("audit_events is append-only (UPDATE and DELETE are rejected)", async () => {
    const repo = drizzleAuthRepo(ctx.db);
    await repo.audit({ action: "test.event" });
    await expect(ctx.db.execute(sql`UPDATE audit_events SET action = 'tampered'`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
    await expect(ctx.db.execute(sql`DELETE FROM audit_events`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
  });

  it("db rate limiter blocks after limit, is per-key, and resets after the window", async () => {
    const rl = makeDbRateLimiter(ctx.db);
    for (let i = 0; i < 3; i++) expect((await rl.hit("k", 3, 60_000)).allowed).toBe(true);
    expect((await rl.hit("k", 3, 60_000)).allowed).toBe(false);
    expect((await rl.hit("other", 3, 60_000)).allowed).toBe(true);
    await ctx.db.execute(sql`UPDATE rate_limits SET window_start = now() - interval '2 minutes' WHERE key = 'k'`);
    expect((await rl.hit("k", 3, 60_000)).allowed).toBe(true);
  });

  it("concurrent rate-limit hits are counted atomically", async () => {
    const rl = makeDbRateLimiter(ctx.db);
    const rs = await Promise.all(Array.from({ length: 10 }, () => rl.hit("burst", 4, 60_000)));
    expect(rs.filter((r) => r.allowed)).toHaveLength(4);
  });
});
