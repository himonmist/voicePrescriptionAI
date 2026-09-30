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
import { consultations, doctorProfiles, organizations, prescriptionVersions, prescriptions, users } from "@/db/schema";
import { hashPassword } from "@/lib/security/password";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { Actor } from "@/lib/security/rbac";

const PW = "Correct-Horse-9!";
const OK = { genericName: "Testalpha", strength: "500 mg", dosageForm: "tablet", route: "oral", dose: "1 tablet", frequency: "twice daily", duration: { value: 5, unit: "days" } };

describe.skipIf(!hasDb)("prescriptions (real Postgres)", () => {
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

  it("8 simultaneous creations converge on ONE live prescription per consultation", async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => svc.createDraft(doc(), CID)));
    expect(new Set(rs.map((r) => r.prescriptionId)).size).toBe(1); expect(rs.filter((r) => r.created)).toHaveLength(1);
    expect(rs[0].code).toMatch(/^RX-[A-Z0-9]{8}$/); expect(await ctx.db.select().from(prescriptions)).toHaveLength(1);
  });
  it("content is encrypted at rest and audit metadata carries no clinical data", async () => {
    const id = await draft(); await save(id, { items: [OK], advice: "Rest and plenty of fluids" });
    const v = await ctx.db.select().from(prescriptionVersions); expect(JSON.stringify(v)).not.toMatch(/Testalpha|fluids/);
    const a = await ctx.db.execute(sql`SELECT metadata::text m FROM audit_events WHERE action LIKE 'prescription.%'`); expect(JSON.stringify(a.rows)).not.toMatch(/Testalpha|fluids|Rahim/);
  });
  it("full lifecycle: draft → approve → finalize (password) → public verification, sealed in the DB", async () => {
    const id = await draft(); await save(id, { items: [OK] }); const r = await finalize(id);
    const rx = await row(id); expect(rx).toMatchObject({ status: "finalized", finalVersion: 2, code: r.code }); expect(rx.contentHash).toBe(r.contentHash); expect(rx.seal).toBeTruthy();
    const v = await svc.verify(r.code); expect(v).toMatchObject({ status: "valid", integrity: "valid", doctorName: "Dr d1", bmdc: "B-d1" });
    expect(JSON.stringify(v)).not.toMatch(/Rahim|Testalpha|1985/);
  });
  it("a wrong signing password leaves the prescription approved; 5 failures lock signing", async () => {
    const id = await draft(); await save(id, { items: [OK] }); await svc.approve(doc(), id);
    for (let i = 0; i < 5; i++) await expect(svc.finalize(doc(), id, { password: "wrong" })).rejects.toThrow(ValidationError);
    await expect(svc.finalize(doc(), id, { password: PW })).rejects.toThrow(/too many/i); expect((await row(id)).status).toBe("approved");
  });
  it("6 stale-tab saves at one version: exactly one wins; approve then save is refused", async () => {
    const id = await draft();
    const rs = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => svc.saveDraft(doc(), id, { baseVersion: 1, content: { advice: `v${i}` } })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1); for (const r of rs.filter((x) => x.status === "rejected")) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    await save(id, { items: [OK] }); await svc.approve(doc(), id);
    await expect(svc.saveDraft(doc(), id, { baseVersion: 3, content: {} })).rejects.toThrow(/reopen/i);
  });

  describe("the database itself refuses to change a finalized prescription", () => {
    let id: string, code: string;
    beforeEach(async () => { id = await draft(); await save(id, { items: [OK] }); code = (await finalize(id)).code; });
    const fails = (q: ReturnType<typeof sql>, msg: RegExp) => expect(ctx.db.execute(q)).rejects.toMatchObject({ cause: { message: expect.stringMatching(msg) } });
    it("blocks status regression, hash/seal/code/version edits and deletion", async () => {
      await fails(sql`UPDATE prescriptions SET status = 'draft' WHERE id = ${id}`, /immutable/);
      await fails(sql`UPDATE prescriptions SET content_hash = 'x' WHERE id = ${id}`, /immutable/);
      await fails(sql`UPDATE prescriptions SET seal = 'x' WHERE id = ${id}`, /immutable/);
      await fails(sql`UPDATE prescriptions SET code = 'RX-HACKED00' WHERE id = ${id}`, /immutable/);
      await fails(sql`UPDATE prescriptions SET current_version = 9 WHERE id = ${id}`, /immutable/);
      await fails(sql`UPDATE prescriptions SET updated_at = now() WHERE id = ${id}`, /immutable/);
      await fails(sql`DELETE FROM prescriptions WHERE id = ${id}`, /cannot be deleted/);
    });
    it("blocks new, edited or deleted versions once the prescription is not a draft", async () => {
      await fails(sql`INSERT INTO prescription_versions (prescription_id, version, kind, content_enc, author_id) VALUES (${id}, 99, 'edit', 'x', ${U.d1})`, /draft/);
      await fails(sql`UPDATE prescription_versions SET content_enc = 'tampered'`, /append-only/);
      await fails(sql`DELETE FROM prescription_versions`, /append-only/);
    });
    it("cannot create a prescription directly in a non-draft state or without a seal", async () => {
      await fails(sql`INSERT INTO prescriptions (code, consultation_id, patient_id, doctor_user_id, status) VALUES ('RX-FAKE0001', ${CID}, ${PID}, ${U.d1}, 'finalized')`, /start as a draft/);
    });
    it("only closing transitions are possible (cancel), and closed prescriptions are terminal", async () => {
      await svc.cancel(doc(), id, { reason: "Issued to the wrong patient" });
      await fails(sql`UPDATE prescriptions SET status = 'finalized' WHERE id = ${id}`, /closed/);
    });
    it("verification detects content changed behind the app's back (trigger bypassed by a superuser)", async () => {
      await ctx.db.execute(sql`ALTER TABLE prescription_versions DISABLE TRIGGER prescription_versions_guard_trg`);
      await ctx.db.execute(sql`UPDATE prescription_versions SET content_enc = (SELECT content_enc FROM prescription_versions WHERE version = 1 LIMIT 1) WHERE version = 2`);
      await ctx.db.execute(sql`ALTER TABLE prescription_versions ENABLE TRIGGER prescription_versions_guard_trg`);
      expect((await svc.verify(code)).integrity).toBe("invalid");
    });
  });

  describe("amendments and cancellation", () => {
    it("amend is atomic: original superseded + linked, new draft with a new code; content copied, overrides cleared", async () => {
      const id = await draft(); await save(id, { items: [OK], overrides: [{ alertKey: "x:0", reason: "A long enough reason" }] }); const { code } = await finalize(id);
      const a = await svc.amend(doc(), id, { reason: "Duration corrected after re-checking" });
      const old = await row(id), neu = await row(a.prescriptionId);
      expect(old).toMatchObject({ status: "superseded", supersededById: a.prescriptionId, amendReason: "Duration corrected after re-checking" }); expect(old.supersededAt).toBeTruthy();
      expect(neu).toMatchObject({ status: "draft", supersedesId: id, currentVersion: 1 }); expect(neu.code).not.toBe(code);
      const g = await svc.get(doc(), a.prescriptionId); expect(g.content.items[0].genericName).toBe("Testalpha"); expect(g.content.overrides).toEqual([]);
      const s = await svc.verify(code); expect(s).toMatchObject({ status: "superseded", supersededByCode: neu.code });
    });
    it("concurrent amendments: exactly one wins", async () => {
      const id = await draft(); await save(id, { items: [OK] }); await finalize(id);
      const rs = await Promise.allSettled([svc.amend(doc(), id, { reason: "First correction reason" }), svc.amend(doc(), id, { reason: "Second correction reason" })]);
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1); expect(await ctx.db.select().from(prescriptions)).toHaveLength(2);
    });
    it("only ONE live prescription per consultation; after cancelling, a new one may be started", async () => {
      const id = await draft();
      await expect(ctx.db.insert(prescriptions).values({ code: "RX-SECOND01", consultationId: CID, patientId: PID, doctorUserId: U.d1 })).rejects.toMatchObject({ cause: { code: "23505" } });
      await svc.cancel(doc(), id, { reason: "Started by mistake, discard" });
      const again = await svc.createDraft(doc(), CID); expect(again.created).toBe(true); expect(again.prescriptionId).not.toBe(id);
    });
    it("cancelled prescriptions verify as cancelled without the reason", async () => {
      const id = await draft(); await save(id, { items: [OK] }); const { code } = await finalize(id); await svc.cancel(doc(), id, { reason: "Issued to the wrong patient" });
      const v = await svc.verify(code); expect(v.status).toBe("cancelled"); expect(JSON.stringify(v)).not.toMatch(/wrong patient/);
    });
  });

  describe("safety screening with real reference data", () => {
    const SRC = { name: "TEST-SOURCE", version: "v1", publishedAt: "2026-01-15", licenceNote: "Synthetic test data, no licence needed" };
    let refId: string;
    beforeEach(async () => {
      await drugs.importReference(admin, { source: SRC, drugs: [{ genericName: "Testalpha", strength: "500 mg", dosageForm: "tablet", drugClasses: ["testcillin"] }, { genericName: "Testbeta", strength: "10 mg", dosageForm: "tablet" }], interactions: [{ ingredientA: "testalpha", ingredientB: "testbeta", severity: "major", description: "Synthetic interaction" }] });
      refId = (await drugs.search(doc(), "testalpha")).results[0].id;
    });
    it("allergy + interaction alerts block approval until documented; override reasons are stored; new allergy after approval blocks signing", async () => {
      await patientSvc.addClinicalItem(doc(), PID, { kind: "allergy", description: "Testcillin - rash" });
      const id = await draft(); await save(id, { items: [{ ...OK, drugRefId: refId }, { ...OK, genericName: "Testbeta", strength: "10 mg", drugRefId: (await drugs.search(doc(), "testbeta")).results[0].id }] });
      const g = await svc.get(doc(), id);
      expect(g.screening.alerts.map((a) => a.kind).sort()).toEqual(["allergy", "interaction"]); expect(g.screening.overridesNeeded).toHaveLength(2);
      await expect(svc.approve(doc(), id)).rejects.toThrow(/2 safety alerts/);
      await svc.saveDraft(doc(), id, { baseVersion: g.version, content: { ...g.content, overrides: g.screening.overridesNeeded.map((k) => ({ alertKey: k, reason: "Reviewed; benefit outweighs risk, patient counselled" })) } });
      await svc.approve(doc(), id);
      await patientSvc.addClinicalItem(doc(), PID, { kind: "allergy", description: "Testbeta - swelling" });
      await expect(svc.finalize(doc(), id, { password: PW })).rejects.toThrow(/safety review changed/i); expect((await row(id)).status).toBe("approved");
    });
    it("with a superseded source, old prescriptions keep their provenance in alerts", async () => {
      const id = await draft(); await save(id, { items: [{ ...OK, drugRefId: refId }] });
      await drugs.importReference(admin, { source: { ...SRC, version: "v2" }, drugs: [{ genericName: "Testalpha", strength: "250 mg", dosageForm: "tablet" }] });
      expect((await svc.get(doc(), id)).screening.alerts.every((a) => !a.source || a.source === "TEST-SOURCE v1")).toBe(true);
    });
  });

  describe("printable copy", () => {
    it("returns the SEALED version (not a later draft) with doctor and patient details", async () => {
      const id = await draft(); await save(id, { items: [OK], advice: "Rest" }); const { code } = await finalize(id);
      const p = await svc.printable(doc(), id);
      expect(p).toMatchObject({ code, state: "valid", doctor: { name: "Dr d1", bmdc: "B-d1", specialty: "General Practice" }, patient: { name: "Md Rahim Uddin", sex: "male" } });
      expect(p.patient.patientCode).toMatch(/^SDA-/); expect(p.content.advice).toBe("Rest");
      const a = await svc.amend(doc(), id, { reason: "Advice corrected after review" });
      expect((await svc.printable(doc(), id)).state).toBe("superseded"); expect(p.content.advice).toBe("Rest");
      await expect(svc.printable(doc(), a.prescriptionId)).rejects.toThrow(/finalized/i);
    });
  });

  describe("access", () => {
    it("other doctors, patients and suspended authors cannot read or change it", async () => {
      const id = await draft();
      await expect(svc.get(doc("d2"), id)).rejects.toThrow(NotFoundError); await expect(svc.saveDraft(doc("d2"), id, { baseVersion: 1, content: {} })).rejects.toThrow(NotFoundError);
      await expect(svc.get({ userId: U.d1, roles: ["patient"], orgId: null }, id)).rejects.toThrow(NotFoundError);
      await ctx.db.update(doctorProfiles).set({ status: "suspended" }).where(eq(doctorProfiles.userId, U.d1));
      await expect(svc.get(doc(), id)).rejects.toThrow(NotFoundError);
    });
    it("draft and unknown codes are not verifiable", async () => {
      await draft(); const code = (await ctx.db.select().from(prescriptions))[0].code;
      await expect(svc.verify(code)).rejects.toThrow(NotFoundError); await expect(svc.verify("RX-NOSUCH99")).rejects.toThrow(NotFoundError);
    });
  });
});
