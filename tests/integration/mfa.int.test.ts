import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { hasDb, setupTestDb, resetData } from "./db";
import { drizzleAuthRepo } from "@/server/auth/drizzle-repo";
import { createAuthService } from "@/server/auth/service";
import { drizzleMfaRepo } from "@/server/mfa/drizzle-repo";
import { createMfaService } from "@/server/mfa/service";
import { makeDbRateLimiter } from "@/lib/security/rate-limit-db";
import { generateTotp } from "@/lib/security/totp";
import { hashPassword } from "@/lib/security/password";
import { users, userRecoveryCodes, sessions } from "@/db/schema";

describe.skipIf(!hasDb)("MFA lifecycle (real Postgres)", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => { process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-32+"; process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64"); ctx = await setupTestDb(); });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => { await resetData(ctx.db); await ctx.db.execute(sql`TRUNCATE user_recovery_codes`); });

  const PW = "Correct-Horse-9!";
  async function setup() {
    const rl = makeDbRateLimiter(ctx.db);
    const auth = createAuthService(drizzleAuthRepo(ctx.db), rl);
    const mfa = createMfaService(drizzleMfaRepo(ctx.db), rl);
    const repo = drizzleAuthRepo(ctx.db);
    const admin = await repo.createUser({ email: "admin@x.com", fullName: "Admin", phone: "01712345678", passwordHash: await hashPassword(PW), roles: ["super_admin"] });
    return { auth, mfa, admin, repo };
  }

  it("admin without MFA is restricted, enrols, is forced to re-login, then needs the code", async () => {
    const { auth, mfa, admin } = await setup();
    const first = await auth.login({ email: "admin@x.com", password: PW }, { ip: "1" });
    if (!first.ok) throw new Error("login failed");
    expect(first.mfaPending).toBe(true);
    expect((await auth.authenticate(first.token))?.mfaPending).toBe(true);

    const { secret } = await mfa.start(admin.id, "admin@x.com");
    // A pending (unconfirmed) secret must NOT change login behaviour yet.
    expect((await auth.login({ email: "admin@x.com", password: PW }, { ip: "1" })).ok).toBe(true);

    const { recoveryCodes } = await mfa.confirm(admin.id, generateTotp(secret, Date.now()));
    expect(recoveryCodes).toHaveLength(8);
    expect(await auth.authenticate(first.token)).toBeNull(); // sessions revoked on enrolment

    const noCode = await auth.login({ email: "admin@x.com", password: PW }, { ip: "1" });
    expect(noCode).toMatchObject({ ok: false, mfaRequired: true });
    const withCode = await auth.login({ email: "admin@x.com", password: PW, totp: generateTotp(secret, Date.now()) }, { ip: "1" });
    if (!withCode.ok) throw new Error("mfa login failed");
    expect(withCode.mfaPending).toBe(false);
    expect((await auth.authenticate(withCode.token))?.mfaPending).toBeFalsy();
  });

  it("stores the TOTP secret encrypted and recovery codes only as hashes", async () => {
    const { mfa, admin } = await setup();
    const { secret } = await mfa.start(admin.id, "admin@x.com");
    const { recoveryCodes } = await mfa.confirm(admin.id, generateTotp(secret, Date.now()));
    const [u] = await ctx.db.select().from(users).where(eq(users.id, admin.id));
    expect(u.mfaSecretEnc).toBeTruthy(); expect(u.mfaSecretEnc).not.toContain(secret);
    const rows = await ctx.db.select().from(userRecoveryCodes);
    expect(rows).toHaveLength(8);
    for (const c of recoveryCodes) expect(JSON.stringify(rows)).not.toContain(c);
  });

  it("recovery code works exactly once", async () => {
    const { auth, mfa, admin } = await setup();
    const { secret } = await mfa.start(admin.id, "admin@x.com");
    const { recoveryCodes } = await mfa.confirm(admin.id, generateTotp(secret, Date.now()));
    const use = () => auth.login({ email: "admin@x.com", password: PW, recoveryCode: recoveryCodes[0].toUpperCase() }, { ip: "1" });
    expect((await use()).ok).toBe(true);
    expect((await use()).ok).toBe(false);
    expect((await auth.login({ email: "admin@x.com", password: PW, recoveryCode: recoveryCodes[1] }, { ip: "1" })).ok).toBe(true);
  });

  it("concurrent use of the same recovery code succeeds only once", async () => {
    const { auth, mfa, admin } = await setup();
    const { secret } = await mfa.start(admin.id, "admin@x.com");
    const { recoveryCodes } = await mfa.confirm(admin.id, generateTotp(secret, Date.now()));
    const rs = await Promise.all(Array.from({ length: 4 }, (_, i) => auth.login({ email: "admin@x.com", password: PW, recoveryCode: recoveryCodes[2] }, { ip: `9.9.9.${i}` })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });

  it("a regular user can disable MFA with password + code; sessions are revoked", async () => {
    const { auth, mfa, repo } = await setup();
    const u = await repo.createUser({ email: "p@x.com", fullName: "P", phone: "01712345679", passwordHash: await hashPassword(PW), roles: ["patient"] });
    const { secret } = await mfa.start(u.id, "p@x.com");
    await mfa.confirm(u.id, generateTotp(secret, Date.now()));
    await mfa.disable(u.id, PW, generateTotp(secret, Date.now()));
    expect((await mfa.state(u.id)).enabled).toBe(false);
    expect((await auth.login({ email: "p@x.com", password: PW }, { ip: "2" })).ok).toBe(true);
    expect(await ctx.db.select().from(userRecoveryCodes)).toHaveLength(0);
    const active = await ctx.db.select().from(sessions).where(sql`revoked_at IS NULL`);
    expect(active).toHaveLength(1); // only the fresh login above
  });
});
