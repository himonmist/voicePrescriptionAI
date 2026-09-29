import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { appointments, auditEvents, audioSessions, clinicalNoteVersions, clinicalNotes, consultations, transcriptSegments, users } from "@/db/schema";
import { decryptField, encryptField } from "@/lib/security/crypto";
import { ConflictError, ValidationError } from "@/server/errors";
import type { NoteContent } from "./note";
import type { ConsultRepo, Consultation, NoteRow, Segment } from "./service";

const UUID = /^[0-9a-f-]{36}$/i;
const codeOf = (e: unknown): string | undefined => (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
const toC = (r: typeof consultations.$inferSelect): Consultation => ({ id: r.id, appointmentId: r.appointmentId, doctorUserId: r.doctorUserId, patientId: r.patientId, organizationId: r.organizationId, mode: r.mode, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt });
const toSeg = (r: typeof transcriptSegments.$inferSelect): Segment => ({ id: r.id, consultationId: r.consultationId, seq: r.seq, speaker: r.speaker, text: decryptField(r.textEnc), originalText: r.originalTextEnc ? decryptField(r.originalTextEnc) : null, startMs: r.startMs, endMs: r.endMs, source: r.source, flagged: r.flagged });
const enc = (n: NoteContent) => encryptField(JSON.stringify(n));
const dec = (s: string): NoteContent => JSON.parse(decryptField(s));

export function drizzleConsultRepo(db: Db = getDb()): ConsultRepo {
  return {
    async appointment(id) {
      if (!UUID.test(id)) return null;
      const [a] = await db.select({ id: appointments.id, doctorUserId: appointments.doctorUserId, patientId: appointments.patientId, organizationId: appointments.organizationId, status: appointments.status, mode: appointments.mode }).from(appointments).where(eq(appointments.id, id)).limit(1);
      return a ?? null;
    },
    async findByAppointment(id) { const [c] = await db.select().from(consultations).where(eq(consultations.appointmentId, id)).limit(1); return c ? toC(c) : null; },
    async findOpenWalkIn(d, p) {
      const [c] = await db.select().from(consultations).where(and(eq(consultations.doctorUserId, d), eq(consultations.patientId, p), eq(consultations.status, "in_progress"), sql`${consultations.appointmentId} IS NULL`)).limit(1);
      return c ? toC(c) : null;
    },
    async createOrGet(i) {
      return db.transaction(async (tx) => {
        const [ins] = await tx.insert(consultations).values({ appointmentId: i.appointmentId, doctorUserId: i.doctorUserId, patientId: i.patientId, organizationId: i.organizationId, mode: i.mode, createdBy: i.createdBy }).onConflictDoNothing().returning();
        if (ins) {
          if (i.appointmentId) await tx.update(appointments).set({ status: "in_progress", startedAt: new Date(), updatedAt: new Date() }).where(and(eq(appointments.id, i.appointmentId), eq(appointments.status, "checked_in")));
          return { consultation: toC(ins), created: true };
        }
        const [ex] = await tx.select().from(consultations).where(i.appointmentId ? eq(consultations.appointmentId, i.appointmentId)
          : and(eq(consultations.doctorUserId, i.doctorUserId), eq(consultations.patientId, i.patientId), eq(consultations.status, "in_progress"), sql`${consultations.appointmentId} IS NULL`)).limit(1);
        if (!ex) throw new ConflictError("Could not start the consultation; please retry");
        return { consultation: toC(ex), created: false };
      });
    },
    async get(id) { if (!UUID.test(id)) return null; const [c] = await db.select().from(consultations).where(eq(consultations.id, id)).limit(1); return c ? toC(c) : null; },
    async complete(id) {
      await db.transaction(async (tx) => {
        const [c] = await tx.update(consultations).set({ status: "completed", endedAt: new Date(), updatedAt: new Date() }).where(and(eq(consultations.id, id), eq(consultations.status, "in_progress"))).returning({ appointmentId: consultations.appointmentId });
        if (!c) throw new ValidationError("This consultation is already completed");
        await tx.update(audioSessions).set({ status: "stopped", endedAt: new Date(), stopReason: "consultation_completed" }).where(and(eq(audioSessions.consultationId, id), ne(audioSessions.status, "stopped")));
        if (c.appointmentId) await tx.update(appointments).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(appointments.id, c.appointmentId), eq(appointments.status, "in_progress")));
      });
    },
    async listSegments(cid) { return (await db.select().from(transcriptSegments).where(eq(transcriptSegments.consultationId, cid)).orderBy(asc(transcriptSegments.seq))).map(toSeg); },
    async addSegment(cid, s) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM consultations WHERE id = ${cid} FOR UPDATE`); // serialize seq assignment per consultation
        const [{ next }] = (await tx.execute(sql`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM transcript_segments WHERE consultation_id = ${cid}`)).rows as { next: number }[];
        const [r] = await tx.insert(transcriptSegments).values({ consultationId: cid, seq: Number(next), speaker: s.speaker, textEnc: encryptField(s.text), startMs: s.startMs ?? null, endMs: s.endMs ?? null, createdBy: s.createdBy }).returning();
        return toSeg(r);
      });
    },
    async getSegment(cid, id) { if (!UUID.test(id)) return null; const [r] = await db.select().from(transcriptSegments).where(and(eq(transcriptSegments.id, id), eq(transcriptSegments.consultationId, cid))).limit(1); return r ? toSeg(r) : null; },
    async updateSegment(cid, id, patch, editorId) {
      const set: Record<string, unknown> = { editedBy: editorId, updatedAt: new Date() };
      if (patch.text !== undefined) { set.originalTextEnc = sql`COALESCE(${transcriptSegments.originalTextEnc}, ${transcriptSegments.textEnc})`; set.textEnc = encryptField(patch.text); }
      if (patch.flagged !== undefined) set.flagged = patch.flagged;
      if (patch.speaker !== undefined) set.speaker = patch.speaker;
      const [r] = await db.update(transcriptSegments).set(set).where(and(eq(transcriptSegments.id, id), eq(transcriptSegments.consultationId, cid))).returning();
      return toSeg(r);
    },
    async getNote(cid): Promise<NoteRow | null> {
      const [n] = await db.select().from(clinicalNotes).where(eq(clinicalNotes.consultationId, cid)).limit(1);
      if (!n || n.currentVersion === 0) return null;
      const [v] = await db.select().from(clinicalNoteVersions).where(and(eq(clinicalNoteVersions.noteId, n.id), eq(clinicalNoteVersions.version, n.currentVersion))).limit(1);
      return { id: n.id, status: n.status, currentVersion: n.currentVersion, approvedBy: n.approvedBy, approvedAt: n.approvedAt, content: dec(v.contentEnc) };
    },
    async saveVersion(v) {
      return db.transaction(async (tx) => {
        await tx.insert(clinicalNotes).values({ consultationId: v.consultationId }).onConflictDoNothing();
        // The row lock taken by this UPDATE serializes racing saves; the loser sees a changed version and matches 0 rows.
        const [n] = await tx.update(clinicalNotes).set({ currentVersion: sql`${clinicalNotes.currentVersion} + 1`, updatedAt: new Date() })
          .where(and(eq(clinicalNotes.consultationId, v.consultationId), eq(clinicalNotes.currentVersion, v.baseVersion))).returning({ id: clinicalNotes.id, version: clinicalNotes.currentVersion, status: clinicalNotes.status });
        if (!n) throw new ConflictError("The note was changed elsewhere. Reload to see the latest version.");
        if (n.status === "approved" && v.kind !== "amendment") throw new ConflictError("The note was approved meanwhile; changes must be recorded as an amendment."); // rolls back the bump
        await tx.insert(clinicalNoteVersions).values({ noteId: n.id, version: n.version, kind: v.kind, contentEnc: enc(v.content), authorId: v.authorId, summary: v.summary ?? null });
        return { version: n.version };
      });
    },
    async approveNote(cid, by) {
      const r = await db.update(clinicalNotes).set({ status: "approved", approvedBy: by, approvedAt: new Date(), updatedAt: new Date() }).where(and(eq(clinicalNotes.consultationId, cid), eq(clinicalNotes.status, "draft"))).returning({ id: clinicalNotes.id });
      return r.length > 0;
    },
    async listVersions(cid) {
      const rows = await db.select({ version: clinicalNoteVersions.version, kind: clinicalNoteVersions.kind, authorId: clinicalNoteVersions.authorId, authorName: users.fullName, summary: clinicalNoteVersions.summary, createdAt: clinicalNoteVersions.createdAt })
        .from(clinicalNoteVersions).innerJoin(clinicalNotes, eq(clinicalNotes.id, clinicalNoteVersions.noteId)).innerJoin(users, eq(users.id, clinicalNoteVersions.authorId))
        .where(eq(clinicalNotes.consultationId, cid)).orderBy(asc(clinicalNoteVersions.version));
      return rows;
    },
    async getVersion(cid, version) {
      const [r] = await db.select({ v: clinicalNoteVersions }).from(clinicalNoteVersions).innerJoin(clinicalNotes, eq(clinicalNotes.id, clinicalNoteVersions.noteId)).where(and(eq(clinicalNotes.consultationId, cid), eq(clinicalNoteVersions.version, version))).limit(1);
      return r ? { version: r.v.version, kind: r.v.kind, content: dec(r.v.contentEnc), authorId: r.v.authorId, summary: r.v.summary, createdAt: r.v.createdAt } : null;
    },
    async activeSession(cid) { const [s] = await db.select({ id: audioSessions.id, status: audioSessions.status }).from(audioSessions).where(and(eq(audioSessions.consultationId, cid), ne(audioSessions.status, "stopped"))).orderBy(desc(audioSessions.startedAt)).limit(1); return s ?? null; },
    async startSession(i) {
      try { const [s] = await db.insert(audioSessions).values({ consultationId: i.consultationId, startedBy: i.startedBy, consentVerifiedAt: new Date() }).returning({ id: audioSessions.id }); return s.id; }
      catch (e) { if (codeOf(e) === "23505") throw new ConflictError("A recording is already open for this consultation"); throw e; }
    },
    async setSessionStatus(id, from, to, reason) {
      const r = await db.update(audioSessions).set(to === "stopped" ? { status: to, endedAt: new Date(), stopReason: reason ?? "manual" } : { status: to })
        .where(and(eq(audioSessions.id, id), eq(audioSessions.status, from))).returning({ id: audioSessions.id });
      return r.length > 0;
    },
    async audit(e) { await db.insert(auditEvents).values({ action: e.action, actorId: e.actorId, organizationId: e.organizationId ?? null, resourceType: "consultation", resourceId: e.resourceId, metadata: e.metadata ?? {} }); },
  };
}
