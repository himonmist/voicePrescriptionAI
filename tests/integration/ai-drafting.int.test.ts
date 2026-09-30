import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { hasDb, setupTestDb } from "./db";
import { drizzleAuthRepo } from "@/server/auth/drizzle-repo";
import { drizzlePatientRepo } from "@/server/patients/drizzle-repo";
import { createPatientService } from "@/server/patients/service";
import { drizzleConsultRepo } from "@/server/consultations/drizzle-repo";
import { consultDepsFor } from "@/server/consultations/deps";
import { createConsultationService } from "@/server/consultations/service";
import { createDraftingService } from "@/server/ai/drafting";
import { makeDbRateLimiter } from "@/lib/security/rate-limit-db";
import { patientAccessFor } from "@/server/appointments/access";
import { aiUsage, appointments, audioSessions, clinicalNoteVersions, clinicalNotes, consultations, doctorProfiles, organizations, patients, transcriptSegments } from "@/db/schema";
import { ConflictError, NotFoundError } from "@/server/errors";
import type { Actor } from "@/lib/security/rbac";

const NOTE = (t: string) => ({ sections: { chiefComplaint: { state: "documented", text: t } } });

describe.skipIf(!hasDb)("AI drafting (real Postgres)", () => {
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

  it("drafts from a real transcript, stores ai_draft provenance in the encrypted version, records usage; unchanged sections survive a doctor save", async () => {
    const { consultationId } = await svc.start(doc(), { appointmentId: APPT });
    await svc.addSegment(doc(), consultationId, { speaker: "patient", text: "I have had fever for three days" });
    const complete = vi.fn(async () => ({ text: JSON.stringify({ sections: { chiefComplaint: { text: "Fever, 3 days", evidence: ["fever for three days"] }, plan: { text: "Invented plan", evidence: ["paracetamol"] } } }), inputTokens: 10, outputTokens: 5 }));
    const drafting = createDraftingService(drizzleConsultRepo(ctx.db), { provider: { name: "t", model: "m", complete }, patientAccess: patientAccessFor(ctx.db), limiter: makeDbRateLimiter(ctx.db), hasConsent: async () => true, recordUsage: async (u) => { await ctx.db.insert(aiUsage).values(u); } });
    const r = await drafting.draftNote(doc(), consultationId);
    expect(r).toMatchObject({ saved: true, filled: ["chiefComplaint"] }); expect(r.dropped.map((d) => d.item)).toEqual(["plan"]);
    const ws = await svc.getWorkspace(doc(), consultationId);
    expect(ws.note!.content.sections.chiefComplaint).toMatchObject({ origin: "ai_draft", text: "Fever, 3 days" }); expect(ws.note!.content.sections.plan.state).toBe("not_documented");
    const raw = await ctx.db.select().from(clinicalNoteVersions); expect(JSON.stringify(raw)).not.toMatch(/Fever, 3 days/); // encrypted at rest
    const u = await ctx.db.select().from(aiUsage); expect(u).toHaveLength(1); expect(u[0]).toMatchObject({ status: "ok", inputTokens: 10 });
    // doctor saves the note unchanged (as the UI does): still AI-drafted; after an edit it becomes manual
    await svc.saveNote(doc(), consultationId, { baseVersion: 1, content: { sections: { chiefComplaint: { state: "documented", text: "Fever, 3 days" } } } });
    expect((await svc.getWorkspace(doc(), consultationId)).note!.content.sections.chiefComplaint.origin).toBe("ai_draft");
    await svc.saveNote(doc(), consultationId, { baseVersion: 2, content: { sections: { chiefComplaint: { state: "documented", text: "Fever, 3 days, worse at night" } } } });
    expect((await svc.getWorkspace(doc(), consultationId)).note!.content.sections.chiefComplaint.origin).toBe("manual");
  });
});
