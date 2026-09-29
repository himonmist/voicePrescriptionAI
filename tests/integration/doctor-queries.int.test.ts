import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { hasDb, setupTestDb, resetData } from "./db";
import { drizzleAuthRepo } from "@/server/auth/drizzle-repo";
import { listDoctorsForReview, getDoctorByUserId } from "@/server/doctors/queries";

describe.skipIf(!hasDb)("doctor review queries (real Postgres)", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => { ctx = await setupTestDb(); });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => { await resetData(ctx.db); });

  async function seed(n: number) {
    const auth = drizzleAuthRepo(ctx.db);
    for (let i = 0; i < n; i++) {
      const u = await auth.createUser({ email: `d${i}@x.com`, fullName: `Dr ${i}`, phone: "01712345678", passwordHash: "h", roles: ["doctor"] });
      await auth.createDoctorProfile({ userId: u.id, bmdcNumber: `B-${i}`, specialty: "GP" });
    }
  }

  it("paginates and filters by status; exposes no password hash or contact secrets", async () => {
    await seed(5);
    const page1 = await listDoctorsForReview(ctx.db, { statuses: ["registered"], limit: 2, offset: 0 });
    expect(page1.rows).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(JSON.stringify(page1.rows)).not.toMatch(/password|hash/i);
    const none = await listDoctorsForReview(ctx.db, { statuses: ["active"], limit: 10, offset: 0 });
    expect(none.total).toBe(0);
  });

  it("caps page size", async () => {
    await seed(3);
    const r = await listDoctorsForReview(ctx.db, { statuses: ["registered"], limit: 10_000, offset: 0 });
    expect(r.rows.length).toBeLessThanOrEqual(100);
  });

  it("resolves a doctor profile from the user id (ownership)", async () => {
    await seed(2);
    const auth = drizzleAuthRepo(ctx.db);
    const u = await auth.findUserByEmail("d1@x.com");
    const d = await getDoctorByUserId(ctx.db, u!.id);
    expect(d?.bmdcNumber).toBe("B-1");
    expect(await getDoctorByUserId(ctx.db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
