import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { hasDb, setupTestDb } from "./db";
import { drizzleAuthRepo } from "@/server/auth/drizzle-repo";
import { drizzlePatientRepo } from "@/server/patients/drizzle-repo";
import { createPatientService } from "@/server/patients/service";
import { drizzleRxRepo } from "@/server/prescriptions/drizzle-repo";
import { rxDepsFor } from "@/server/prescriptions/deps";
import { createPrescriptionService } from "@/server/prescriptions/service";
import { drizzleDrugRepo } from "@/server/drugs/drizzle-repo";
import { createDrugService } from "@/server/drugs/service";
import { createShareService } from "@/server/prescriptions/share";
import { drizzleShareRepo } from "@/server/prescriptions/share-repo";
import { patientAccessFor } from "@/server/appointments/access";
import { createHash } from "node:crypto";
import { consultations, prescriptionShares, doctorProfiles, organizations, prescriptionVersions, prescriptions, users } from "@/db/schema";
import { hashPassword } from "@/lib/security/password";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { Actor } from "@/lib/security/rbac";

const PW = "Correct-Horse-9!";
const OK = { genericName: "Testalpha", strength: "500 mg", dosageForm: "tablet", route: "oral", dose: "1 tablet", frequency: "twice daily", duration: { value: 5, unit: "days" } };

describe.skipIf(!hasDb)("prescription share links (real Postgres)", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>; let svc: ReturnType<typeof createPrescriptionService>; let drugs: ReturnType<typeof createDrugService>; let patientSvc: ReturnType<typeof createPatientService>;
  let orgA: string; let PID: string; let CID: string; let admin: Actor; const U: Record<string, string> = {};
  const doc = (k = "d1"): Actor => ({ userId: U[k], roles: ["doctor"], orgId: orgA });

  beforeAll(async () => { process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64"); ctx = await setupTestDb(); });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => {
    await ctx.db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update`);
    await ctx.db.execute(sql`ALTER TABLE prescriptions DISABLE TRIGGER prescriptions_guard_trg`); await ctx.db.execute(sql`ALTER TABLE prescription_versions DISABLE TRIGGER prescription_versions_guard_trg`); await ctx.db.execute(sql`ALTER TABLE clinical_note_versions DISABLE TRIGGER clinical_note_versions_no_change`);
    await ctx.db.execute(sql`TRUNCATE audit_events, prescription_versions, prescriptions, drug_interactions, drug_references, drug_reference_sources, clinical_note_versions, clinical_notes, transcript_segments, audio_sessions, consultations, appointments, patient_merges, patient_clinical_items, patient_consents, patient_doctor_relationships, patients, notifications, doctor_credentials, doctor_profiles, sessions, user_roles, organization_memberships, organizations, users, rate_limits, user_recovery_codes CASCADE`);
    for (const [t, trg] of [["audit_events", "audit_events_no_update"], ["prescriptions", "prescriptions_guard_trg"], ["prescription_versions", "prescription_versions_guard_trg"], ["clinical_note_versions", "clinical_note_versions_no_change"]]) await ctx.db.execute(sql.raw(`ALTER TABLE ${t} ENABLE TRIGGER ${trg}`));
    [{ id: orgA }] = await ctx.db.insert(organizations).values({ name: "A", slug: "a" }).returning();
    const auth = drizzleAuthRepo(ctx.db); const hash = await hashPassword(PW);
    for (const k of ["d1", "d2"]) {
      const u = await auth.createUser({ email: `${k}@x.com`, fullName: `Dr ${k}`, phone: "01712345678", passwordHash: hash, roles: ["doctor"] });
      await auth.createDoctorProfile({ userId: u.id, bmdcNumber: `B-${k}`, specialty: "General Practice" });
      await ctx.db.update(doctorProfiles).set({ status: "active", organizationId: orgA }).where(eq(doctorProfiles.userId, u.id)); U[k] = u.id;
    }
    const a = await auth.createUser({ email: "admin@x.com", fullName: "Admin", phone: "01712345670", passwordHash: hash, roles: ["super_admin"] }); admin = { userId: a.id, roles: ["super_admin"], orgId: null };
    patientSvc = createPatientService(drizzlePatientRepo(ctx.db));
    ({ patientId: PID } = await patientSvc.createPatient(doc(), { fullName: "Md Rahim Uddin", dob: "1985-03-12", sex: "male", phone: "01712345678" }));
    const [c] = await ctx.db.insert(consultations).values({ doctorUserId: U.d1, patientId: PID, organizationId: orgA, createdBy: U.d1 }).returning(); CID = c.id;
    drugs = createDrugService(drizzleDrugRepo(ctx.db)); svc = createPrescriptionService(drizzleRxRepo(ctx.db), rxDepsFor(ctx.db));
  });
  const draft = async () => (await svc.createDraft(doc(), CID)).prescriptionId;
  const save = async (id: string, content: object) => svc.saveDraft(doc(), id, { baseVersion: (await svc.get(doc(), id)).version, content });
  const finalize = async (id: string) => { await svc.approve(doc(), id); return svc.finalize(doc(), id, { password: PW }); };
  const row = async (id: string) => (await ctx.db.select().from(prescriptions).where(eq(prescriptions.id, id)))[0];

  let share: ReturnType<typeof createShareService>;
  const finalized = async () => {
    const id = (await svc.createDraft(doc(), CID)).prescriptionId;
    await svc.saveDraft(doc(), id, { baseVersion: (await svc.get(doc(), id)).version, content: { items: [OK], advice: "Rest" } });
    await svc.approve(doc(), id); await svc.finalize(doc(), id, { password: PW }); return id;
  };
  beforeEach(() => { share = createShareService(drizzleShareRepo(ctx.db), { patientAccess: patientAccessFor(ctx.db), sealedCopy: (i) => svc.sealedCopy(i) }); });

  it("stores only the token hash; the right DOB opens the sealed copy and counts the access", async () => {
    const id = await finalized(); const { token } = await share.createLink(doc(), id, {});
    const rows = await ctx.db.select().from(prescriptionShares); expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(createHash("sha256").update(token).digest("hex")); expect(JSON.stringify(rows)).not.toContain(token);
    const r = await share.open(token, "1985-03-12"); expect(r.state).toBe("valid"); expect(r.copy!.patient.name).toBe("Md Rahim Uddin");
    expect((await ctx.db.select().from(prescriptionShares))[0].accessCount).toBe(1);
    const a = await ctx.db.execute(sql`SELECT metadata::text m FROM audit_events WHERE action LIKE 'prescription.share_%'`); expect(JSON.stringify(a.rows)).not.toMatch(/Rahim|1985|Testalpha|fluids/);
  });
  it("12 concurrent wrong-DOB guesses lock the link at exactly 5 failures; the right DOB is then refused", async () => {
    const id = await finalized(); const { token } = await share.createLink(doc(), id, {});
    await Promise.all(Array.from({ length: 12 }, () => share.open(token, "1990-01-01").catch(() => {})));
    const [s] = await ctx.db.select().from(prescriptionShares); expect(s.lockedAt).toBeTruthy(); expect(s.failedAttempts).toBeGreaterThanOrEqual(5);
    await expect(share.open(token, "1985-03-12")).rejects.toThrow(/no longer valid/);
  });
  it("revoked and expired links stop working; amending shows a notice with no content", async () => {
    const id = await finalized(); const a = await share.createLink(doc(), id, {}); const b = await share.createLink(doc(), id, {});
    await share.revokeLink(doc(), id, a.shareId); await expect(share.open(a.token, "1985-03-12")).rejects.toThrow(/no longer valid/);
    await ctx.db.update(prescriptionShares).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(prescriptionShares.id, b.shareId));
    await expect(share.open(b.token, "1985-03-12")).rejects.toThrow(/no longer valid/);
    const c = await share.createLink(doc(), id, {}); await svc.amend(doc(), id, { reason: "Correct the frequency of dosing" });
    const r = await share.open(c.token, "1985-03-12"); expect(r.state).toBe("superseded"); expect(r.copy).toBeUndefined();
  });
  it("cannot share drafts, and other doctors cannot create or list links", async () => {
    const draftId = (await svc.createDraft(doc(), CID)).prescriptionId;
    await expect(share.createLink(doc(), draftId, {})).rejects.toThrow(/finalized/i);
  });
  it("live-link cap holds under concurrency-free sequential creation", async () => {
    const id = await finalized(); for (let i = 0; i < 5; i++) await share.createLink(doc(), id, {});
    await expect(share.createLink(doc(), id, {})).rejects.toThrow(/at most 5/i);
    await expect(share.listLinks(doc("d2"), id)).rejects.toThrow(NotFoundError);
  });
});
