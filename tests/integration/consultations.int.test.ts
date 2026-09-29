import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { hasDb, setupTestDb } from "./db";
import { drizzleAuthRepo } from "@/server/auth/drizzle-repo";
import { drizzlePatientRepo } from "@/server/patients/drizzle-repo";
import { createPatientService } from "@/server/patients/service";
import { drizzleConsultRepo } from "@/server/consultations/drizzle-repo";
import { consultDepsFor } from "@/server/consultations/deps";
import { createConsultationService } from "@/server/consultations/service";
import { appointments, audioSessions, clinicalNoteVersions, clinicalNotes, consultations, doctorProfiles, organizations, patients, transcriptSegments } from "@/db/schema";
import { ConflictError, NotFoundError } from "@/server/errors";
import type { Actor } from "@/lib/security/rbac";

const NOTE = (t: string) => ({ sections: { chiefComplaint: { state: "documented", text: t } } });

describe.skipIf(!hasDb)("consultations (real Postgres)", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  let svc: ReturnType<typeof createConsultationService>;
  let patientSvc: ReturnType<typeof createPatientService>;
  let orgA: string; const U: Record<string, string> = {}; let PID: string; let APPT: string;
  const doc = (k = "d1"): Actor => ({ userId: U[k], roles: ["doctor"], orgId: orgA });

  beforeAll(async () => { process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64"); ctx = await setupTestDb(); });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => {
    await ctx.db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update`);
    await ctx.db.execute(sql`TRUNCATE audit_events, clinical_note_versions, clinical_notes, transcript_segments, audio_sessions, consultations, appointments, availability_exceptions, availability_schedules, patient_merges, patient_clinical_items, patient_consents, patient_doctor_relationships, patients, notifications, doctor_credentials, doctor_profiles, sessions, user_roles, organization_memberships, organizations, users, rate_limits, user_recovery_codes CASCADE`);
    await ctx.db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update`);
    [{ id: orgA }] = await ctx.db.insert(organizations).values({ name: "A", slug: "a" }).returning();
    const auth = drizzleAuthRepo(ctx.db);
    for (const k of ["d1", "d2", "d3"]) {
      const u = await auth.createUser({ email: `${k}@x.com`, fullName: `Dr ${k}`, phone: "01712345678", passwordHash: "h", roles: ["doctor"] });
      await auth.createDoctorProfile({ userId: u.id, bmdcNumber: `B-${k}`, specialty: "GP" });
      await ctx.db.update(doctorProfiles).set({ status: "active", organizationId: orgA }).where(eq(doctorProfiles.userId, u.id));
      U[k] = u.id;
    }
    const r = await auth.createUser({ email: "r@x.com", fullName: "Recep", phone: "01712345670", passwordHash: "h", roles: ["receptionist"] }); U.r = r.id;
    const pr = drizzlePatientRepo(ctx.db);
    patientSvc = createPatientService(pr);
    ({ patientId: PID } = await patientSvc.createPatient(doc("d1"), { fullName: "Md Rahim Uddin", dob: "1985-03-12", sex: "male", phone: "01712345678" }));
    await patientSvc.addClinicalItem(doc("d1"), PID, { kind: "allergy", description: "Penicillin - rash", severity: "moderate" });
    const [a] = await ctx.db.insert(appointments).values({ doctorUserId: U.d1, patientId: PID, organizationId: orgA, startAt: new Date(Date.now() + 3600_000), endAt: new Date(Date.now() + 7200_000), mode: "in_person", status: "checked_in", bookedBy: U.d1, bookedVia: "doctor" }).returning();
    APPT = a.id;
    svc = createConsultationService(drizzleConsultRepo(ctx.db), consultDepsFor(ctx.db));
  });

  describe("constraints", () => {
    const ins = (o: Partial<typeof consultations.$inferInsert>) => ctx.db.insert(consultations).values({ doctorUserId: U.d1, patientId: PID, createdBy: U.d1, ...o });
    it("one consultation per appointment", async () => {
      await ins({ appointmentId: APPT });
      await expect(ins({ appointmentId: APPT })).rejects.toMatchObject({ cause: { code: "23505" } });
    });
    it("one OPEN walk-in per doctor+patient; a new one is allowed once the previous is completed", async () => {
      await ins({}); await expect(ins({})).rejects.toMatchObject({ cause: { code: "23505" } });
      await ctx.db.update(consultations).set({ status: "completed" });
      await ins({});
    });
    it("rejects invalid statuses and modes", async () => {
      await expect(ins({ status: "weird" })).rejects.toThrow(); await expect(ins({ mode: "telepathy" })).rejects.toThrow();
    });
    it("only one non-stopped audio session per consultation", async () => {
      const [c] = await ins({}).returning();
      const s = (status: string) => ctx.db.insert(audioSessions).values({ consultationId: c.id, startedBy: U.d1, consentVerifiedAt: new Date(), status });
      await s("active"); await expect(s("paused")).rejects.toMatchObject({ cause: { code: "23505" } });
      await ctx.db.update(audioSessions).set({ status: "stopped" }); await s("active");
    });
    it("transcript: unique seq per consultation, valid speakers, sane timestamps", async () => {
      const [c] = await ins({}).returning();
      const seg = (o: object) => ctx.db.insert(transcriptSegments).values({ consultationId: c.id, seq: 1, speaker: "doctor", textEnc: "x", createdBy: U.d1, ...o });
      await seg({}); await expect(seg({})).rejects.toThrow();
      await expect(seg({ seq: 2, speaker: "robot" })).rejects.toThrow(); await expect(seg({ seq: 3, startMs: 500, endMs: 100 })).rejects.toThrow();
    });
    it("note versions are immutable: UPDATE and DELETE are rejected by the database", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      await svc.saveNote(doc(), consultationId, { baseVersion: 0, content: NOTE("Fever") });
      await expect(ctx.db.execute(sql`UPDATE clinical_note_versions SET content_enc = 'tampered'`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
      await expect(ctx.db.execute(sql`DELETE FROM clinical_note_versions`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
    });
  });

  describe("starting", () => {
    it("8 simultaneous starts for one appointment converge on ONE consultation; appointment moves to in_progress", async () => {
      const rs = await Promise.all(Array.from({ length: 8 }, () => svc.start(doc(), { appointmentId: APPT })));
      expect(new Set(rs.map((r) => r.consultationId)).size).toBe(1); expect(rs.filter((r) => r.created)).toHaveLength(1);
      expect(await ctx.db.select().from(consultations)).toHaveLength(1);
      const [a] = await ctx.db.select().from(appointments); expect(a.status).toBe("in_progress"); expect(a.startedAt).toBeTruthy();
    });
    it("8 simultaneous walk-in starts also converge", async () => {
      const rs = await Promise.all(Array.from({ length: 8 }, () => svc.start(doc(), { patientId: PID })));
      expect(new Set(rs.map((r) => r.consultationId)).size).toBe(1); expect(await ctx.db.select().from(consultations)).toHaveLength(1);
    });
    it("refuses a booked-but-not-checked-in appointment and another doctor's appointment", async () => {
      await ctx.db.update(appointments).set({ status: "booked" });
      await expect(svc.start(doc(), { appointmentId: APPT })).rejects.toThrow(/check the patient in/i);
      await ctx.db.update(appointments).set({ status: "checked_in" });
      await expect(svc.start(doc("d2"), { appointmentId: APPT })).rejects.toThrow(NotFoundError);
    });
  });

  describe("workspace", () => {
    it("shows the allergy banner from the patient record", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      const w = await svc.getWorkspace(doc(), consultationId);
      expect(w.patient).toMatchObject({ name: "Md Rahim Uddin", allergies: ["Penicillin - rash"] });
    });
    it("encounter-level access: same-org doctor without a patient relationship, receptionist and suspended author all get 404", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      await expect(svc.getWorkspace(doc("d2"), consultationId)).rejects.toThrow(NotFoundError);
      await expect(svc.getWorkspace({ userId: U.r, roles: ["receptionist"], orgId: orgA }, consultationId)).rejects.toThrow(NotFoundError);
      await ctx.db.update(doctorProfiles).set({ status: "suspended" }).where(eq(doctorProfiles.userId, U.d1));
      await expect(svc.getWorkspace(doc(), consultationId)).rejects.toThrow(NotFoundError);
    });
    it("a doctor the patient was shared with sees ONLY the approved note", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      await svc.addSegment(doc(), consultationId, { speaker: "patient", text: "private words" });
      await svc.saveNote(doc(), consultationId, { baseVersion: 0, content: NOTE("Fever 3 days") });
      await patientSvc.shareAccess(doc(), PID, { doctorUserId: U.d2, reason: "Referral", expiresInDays: 7 });
      const draft = await svc.getWorkspace(doc("d2"), consultationId);
      expect(draft.note).toBeNull(); expect(draft.segments).toBeUndefined();
      await svc.approveNote(doc(), consultationId);
      const approved = await svc.getWorkspace(doc("d2"), consultationId);
      expect(approved.note?.content.sections.chiefComplaint.text).toBe("Fever 3 days"); expect(JSON.stringify(approved)).not.toContain("private words");
      await expect(svc.addSegment(doc("d2"), consultationId, { speaker: "doctor", text: "x" })).rejects.toThrow(/forbidden/i);
    });
    it("reads are audited without clinical content", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      await svc.saveNote(doc(), consultationId, { baseVersion: 0, content: NOTE("Secret complaint") }); await svc.getWorkspace(doc(), consultationId);
      const rows = await ctx.db.execute(sql`SELECT action, metadata::text m FROM audit_events WHERE action LIKE 'consultation.%' OR action LIKE 'note.%'`);
      expect(rows.rows.map((r: any) => r.action)).toEqual(expect.arrayContaining(["consultation.started", "consultation.viewed", "note.saved"]));
      expect(JSON.stringify(rows.rows)).not.toMatch(/Secret complaint|Rahim/);
    });
  });

  describe("transcript", () => {
    it("is encrypted at rest, round-trips Bangla, and keeps the first original after edits", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      const s = await svc.addSegment(doc(), consultationId, { speaker: "patient", text: "আমার জ্বর আছে", startMs: 0, endMs: 1500 });
      await svc.updateSegment(doc(), consultationId, s.id, { text: "আমার তিন দিন ধরে জ্বর", flagged: true }); await svc.updateSegment(doc(), consultationId, s.id, { text: "আমার জ্বর, তিন দিন" });
      const [row] = await ctx.db.select().from(transcriptSegments);
      expect(row.textEnc).not.toContain("জ্বর"); expect(row.originalTextEnc).toBeTruthy();
      const seg = (await svc.getWorkspace(doc(), consultationId)).segments![0];
      expect(seg).toMatchObject({ text: "আমার জ্বর, তিন দিন", originalText: "আমার জ্বর আছে", flagged: true, seq: 1 });
    });
    it("12 concurrent additions get unique, gapless sequence numbers", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      await Promise.all(Array.from({ length: 12 }, (_, i) => svc.addSegment(doc(), consultationId, { speaker: i % 2 ? "doctor" : "patient", text: `line ${i}` })));
      const seqs = (await svc.getWorkspace(doc(), consultationId)).segments!.map((s) => s.seq);
      expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    });
  });

  describe("clinical note", () => {
    it("content is encrypted at rest and round-trips", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      await svc.saveNote(doc(), consultationId, { baseVersion: 0, content: { ...NOTE("Chest pain on exertion"), vitals: { pulse: 88 }, diagnoses: [{ text: "Angina", status: "provisional" }] } });
      const [v] = await ctx.db.select().from(clinicalNoteVersions); expect(v.contentEnc).not.toMatch(/Chest|Angina/);
      const n = (await svc.getWorkspace(doc(), consultationId)).note!;
      expect(n.content.sections.chiefComplaint.text).toBe("Chest pain on exertion"); expect(n.content.diagnoses[0]).toEqual({ text: "Angina", status: "provisional" }); expect(n.content.sections.examination.state).toBe("not_documented");
    });
    it("6 stale-tab saves at the same base version: exactly one wins, the rest conflict, nothing is lost", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      const rs = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => svc.saveNote(doc(), consultationId, { baseVersion: 0, content: NOTE(`draft ${i}`) })));
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of rs.filter((r) => r.status === "rejected")) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
      expect(await ctx.db.select().from(clinicalNoteVersions)).toHaveLength(1);
      await svc.saveNote(doc(), consultationId, { baseVersion: 1, content: NOTE("next") });
      expect((await svc.listVersions(doc(), consultationId)).map((v) => v.version)).toEqual([1, 2]);
    });
    it("amendments preserve the approved original and are attributed", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      await svc.saveNote(doc(), consultationId, { baseVersion: 0, content: NOTE("Original text") }); await svc.approveNote(doc(), consultationId);
      await expect(svc.saveNote(doc(), consultationId, { baseVersion: 1, content: NOTE("Silent change") })).rejects.toThrow(/amendment/i);
      await svc.saveNote(doc(), consultationId, { baseVersion: 1, content: NOTE("Corrected text"), amendmentReason: "Transcription error corrected" });
      expect((await svc.getVersion(doc(), consultationId, 1)).content.sections.chiefComplaint.text).toBe("Original text");
      const list = await svc.listVersions(doc(), consultationId);
      expect(list[1]).toMatchObject({ kind: "amendment", authorName: "Dr d1", summary: "Transcription error corrected" });
      expect((await svc.getWorkspace(doc(), consultationId)).note?.status).toBe("approved");
    });
    it("a plain edit that races an approval cannot slip in as an unreviewed change", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      await svc.saveNote(doc(), consultationId, { baseVersion: 0, content: NOTE("v1") });
      const repo = drizzleConsultRepo(ctx.db);
      await repo.approveNote(consultationId, U.d1);
      await expect(repo.saveVersion({ consultationId, baseVersion: 1, content: JSON.parse(JSON.stringify((await repo.getNote(consultationId))!.content)), authorId: U.d1, kind: "edit" })).rejects.toThrow(ConflictError);
      expect(await ctx.db.select().from(clinicalNoteVersions)).toHaveLength(1);
    });
  });

  describe("recording consent", () => {
    it("start is refused without consent; granted consent allows it; WITHDRAWING consent stops the live session immediately", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      await expect(svc.recording(doc(), consultationId, "start")).rejects.toThrow(/consent/i);
      expect(await ctx.db.select().from(audioSessions)).toHaveLength(0);
      await patientSvc.recordConsent(doc(), PID, { kind: "recording", granted: true, method: "in_person" });
      await svc.recording(doc(), consultationId, "start");
      expect((await svc.getWorkspace(doc(), consultationId)).recording?.status).toBe("active");
      await patientSvc.recordConsent(doc(), PID, { kind: "recording", granted: false, method: "in_person", note: "patient changed mind" });
      const [s] = await ctx.db.select().from(audioSessions); expect(s.status).toBe("stopped"); expect(s.stopReason).toBe("consent_withdrawn"); expect(s.endedAt).toBeTruthy();
      await expect(svc.recording(doc(), consultationId, "start")).rejects.toThrow(/consent/i);
      const [ws] = [await svc.getWorkspace(doc(), consultationId)]; expect(ws.consent.recording).toBe(false);
    });
    it("start→pause→resume→stop persists status and timestamps; a second open session conflicts", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      await patientSvc.recordConsent(doc(), PID, { kind: "recording", granted: true, method: "in_person" });
      await svc.recording(doc(), consultationId, "start");
      await expect(svc.recording(doc(), consultationId, "start")).rejects.toThrow(ConflictError);
      await svc.recording(doc(), consultationId, "pause"); await svc.recording(doc(), consultationId, "resume"); await svc.recording(doc(), consultationId, "stop");
      const [s] = await ctx.db.select().from(audioSessions); expect(s).toMatchObject({ status: "stopped", stopReason: "manual" }); expect(s.consentVerifiedAt).toBeTruthy(); expect(s.storageKey).toBeNull();
    });
  });

  describe("completion", () => {
    it("is one transaction: consultation + open recording + appointment; transcript then locked; a manual note can still be approved", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      await patientSvc.recordConsent(doc(), PID, { kind: "recording", granted: true, method: "in_person" });
      await svc.recording(doc(), consultationId, "start");
      await svc.saveNote(doc(), consultationId, { baseVersion: 0, content: NOTE("Fever") });
      await svc.complete(doc(), consultationId);
      const [c] = await ctx.db.select().from(consultations); expect(c.status).toBe("completed"); expect(c.endedAt).toBeTruthy();
      expect((await ctx.db.select().from(audioSessions))[0].stopReason).toBe("consultation_completed");
      expect((await ctx.db.select().from(appointments))[0].status).toBe("completed");
      await expect(svc.addSegment(doc(), consultationId, { speaker: "doctor", text: "late" })).rejects.toThrow(/completed/i);
      await svc.approveNote(doc(), consultationId);
      expect((await ctx.db.select().from(clinicalNotes))[0].status).toBe("approved");
    });
    it("concurrent completes: one wins, the other is told it is already completed", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
      const rs = await Promise.allSettled([svc.complete(doc(), consultationId), svc.complete(doc(), consultationId)]);
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
  });
});
