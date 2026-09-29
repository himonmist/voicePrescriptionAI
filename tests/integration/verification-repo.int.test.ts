import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { hasDb, setupTestDb, resetData } from "./db";
import { drizzleAuthRepo } from "@/server/auth/drizzle-repo";
import { drizzleVerificationRepo } from "@/server/doctors/drizzle-repo";
import { createVerificationService } from "@/server/doctors/verification";
import { doctorProfiles, notifications, auditEvents } from "@/db/schema";
import type { Actor } from "@/lib/security/rbac";

describe.skipIf(!hasDb)("doctor verification (real Postgres)", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => { ctx = await setupTestDb(); });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => { await resetData(ctx.db); });

  async function seedDoctor(bmdc = "A-1001") {
    const auth = drizzleAuthRepo(ctx.db);
    const u = await auth.createUser({ email: `${bmdc}@x.com`, fullName: "Dr Test", phone: "01712345678", passwordHash: "h", roles: ["doctor"] });
    await auth.createDoctorProfile({ userId: u.id, bmdcNumber: bmdc, specialty: "Cardiology" });
    const [p] = await ctx.db.select().from(doctorProfiles).where(eq(doctorProfiles.userId, u.id));
    return { userId: u.id, doctorId: p.id };
  }
  const admin: Actor = { userId: "00000000-0000-0000-0000-000000000001", roles: ["super_admin"], orgId: null };

  it("BMDC number is unique across doctors", async () => {
    await seedDoctor("A-2000");
    await expect(seedDoctor("A-2000")).rejects.toThrow();
  });

  it("walks the workflow, persists reviewer/notes, writes audit + notification", async () => {
    const { userId, doctorId } = await seedDoctor();
    const svc = createVerificationService(drizzleVerificationRepo(ctx.db));
    await svc.submitForVerification(doctorId, { userId, roles: ["doctor"], orgId: null });
    // reviewer must exist as a user (FK)
    const reviewer = await drizzleAuthRepo(ctx.db).createUser({ email: "admin@x.com", fullName: "Admin", phone: "01712345670", passwordHash: "h", roles: ["super_admin"] });
    const a = { ...admin, userId: reviewer.id };
    await svc.decide(doctorId, "under_review", a);
    await svc.decide(doctorId, "approved", a, "BMDC verified manually");
    await svc.decide(doctorId, "active", a);
    const [p] = await ctx.db.select().from(doctorProfiles).where(eq(doctorProfiles.id, doctorId));
    expect(p.status).toBe("active");
    expect(p.reviewedBy).toBe(reviewer.id);
    const n = await ctx.db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(n.map((x) => x.kind)).toEqual(expect.arrayContaining(["doctor_under_review", "doctor_approved", "doctor_activated"]));
    const audits = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, "doctor.status_changed"));
    expect(audits.length).toBe(4);
  });

  it("rejects illegal jumps and leaves state unchanged", async () => {
    const { doctorId } = await seedDoctor();
    const svc = createVerificationService(drizzleVerificationRepo(ctx.db));
    await expect(svc.decide(doctorId, "active", admin)).rejects.toThrow(/transition/i);
    const [p] = await ctx.db.select().from(doctorProfiles).where(eq(doctorProfiles.id, doctorId));
    expect(p.status).toBe("registered");
  });

  it("concurrent conflicting decisions: only one wins (optimistic status guard)", async () => {
    const { doctorId } = await seedDoctor();
    const reviewer = await drizzleAuthRepo(ctx.db).createUser({ email: "admin2@x.com", fullName: "Admin", phone: "01712345671", passwordHash: "h", roles: ["super_admin"] });
    const a = { ...admin, userId: reviewer.id };
    const svc = createVerificationService(drizzleVerificationRepo(ctx.db));
    await ctx.db.update(doctorProfiles).set({ status: "under_review" }).where(eq(doctorProfiles.id, doctorId));
    const res = await Promise.allSettled([svc.decide(doctorId, "approved", a), svc.decide(doctorId, "rejected", a, "no")]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
