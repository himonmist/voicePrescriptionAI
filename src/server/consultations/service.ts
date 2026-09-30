import { z } from "zod";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { AccessLevel } from "@/server/patients/access";
import { carryProvenance, documentedCount, parseNoteInput, vitalWarnings, type NoteContent } from "./note";

export interface Consultation { id: string; appointmentId: string | null; doctorUserId: string; patientId: string; organizationId: string | null; mode: "in_person" | "online" | string; status: "in_progress" | "completed" | "cancelled" | string; startedAt: Date; endedAt: Date | null }
export interface Segment { id: string; consultationId: string; seq: number; speaker: string; text: string; originalText: string | null; startMs?: number | null; endMs?: number | null; source?: string; flagged: boolean }
export interface NoteRow { id: string; status: "draft" | "approved" | string; currentVersion: number; approvedBy: string | null; approvedAt: Date | null; content: NoteContent }
export interface VersionRow { version: number; kind: string; content: NoteContent; authorId: string; summary: string | null; createdAt: Date }
export interface VersionMeta { version: number; kind: string; authorId: string; authorName: string; summary: string | null; createdAt: Date }
export interface ApptLite { id: string; doctorUserId: string; patientId: string; organizationId: string | null; status: string; mode: string }
export interface PatientCtx { name: string; dob: string; sex: string; allergies: string[] }
export interface AuditInput { action: string; actorId: string; organizationId?: string | null; resourceId: string; metadata?: Record<string, unknown> }

export interface ConsultRepo {
  appointment(id: string): Promise<ApptLite | null>;
  findByAppointment(appointmentId: string): Promise<Consultation | null>;
  findOpenWalkIn(doctorUserId: string, patientId: string): Promise<Consultation | null>;
  /** Atomic + idempotent: unique constraints make concurrent starts converge on one row. Moves a checked_in appointment to in_progress in the same transaction. */
  createOrGet(i: { appointmentId: string | null; doctorUserId: string; patientId: string; organizationId: string | null; mode: string; createdBy: string }): Promise<{ consultation: Consultation; created: boolean }>;
  get(id: string): Promise<Consultation | null>;
  /** One transaction: consultation completed, open recording stopped, linked in_progress appointment completed. */
  complete(id: string): Promise<void>;
  listSegments(consultationId: string): Promise<Segment[]>;
  addSegment(consultationId: string, s: { speaker: string; text: string; startMs?: number; endMs?: number; createdBy: string }): Promise<Segment>;
  getSegment(consultationId: string, id: string): Promise<Segment | null>;
  /** Must keep the FIRST original text when text is edited. */
  updateSegment(consultationId: string, id: string, patch: { text?: string; flagged?: boolean; speaker?: string }, editorId: string): Promise<Segment>;
  getNote(consultationId: string): Promise<NoteRow | null>;
  /** Atomic optimistic lock: throws ConflictError unless current version === baseVersion (0 = no note yet). */
  saveVersion(v: { consultationId: string; baseVersion: number; content: NoteContent; authorId: string; kind: "edit" | "amendment"; summary?: string }): Promise<{ version: number }>;
  approveNote(consultationId: string, by: string): Promise<boolean>;
  listVersions(consultationId: string): Promise<VersionMeta[]>;
  getVersion(consultationId: string, version: number): Promise<VersionRow | null>;
  activeSession(consultationId: string): Promise<{ id: string; status: string } | null>;
  startSession(i: { consultationId: string; startedBy: string }): Promise<string>;
  setSessionStatus(id: string, from: string, to: string, reason?: string): Promise<boolean>;
  audit(e: AuditInput): Promise<void>;
}

export interface ConsultDeps {
  patientAccess(actor: Actor, patientId: string): Promise<AccessLevel>;
  hasRecordingConsent(patientId: string): Promise<boolean>;
  patientContext(patientId: string): Promise<PatientCtx>;
}

export interface Workspace {
  access: "author" | "shared_read";
  consultation: Consultation; patient: PatientCtx; consent: { recording: boolean };
  note: NoteRow | null;
  segments?: Segment[]; recording?: { id: string; status: string } | null; warnings?: string[];
}

const segmentInput = z.object({
  speaker: z.enum(["doctor", "patient", "other", "unknown"]),
  text: z.string().transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim()).pipe(z.string().min(1, "Text is required").max(4000)),
  startMs: z.number().int().min(0).max(1e8).optional(), endMs: z.number().int().min(0).max(1e8).optional(),
}).refine((s) => s.startMs === undefined || s.endMs === undefined || s.endMs >= s.startMs, "End time must not be before start time");
const segmentPatch = z.object({
  text: z.string().transform((s) => s.trim()).pipe(z.string().min(1, "Text is required").max(4000)).optional(),
  flagged: z.boolean().optional(), speaker: z.enum(["doctor", "patient", "other", "unknown"]).optional(),
}).strict().refine((p) => Object.keys(p).length > 0, "Nothing to change");
const startInput = z.object({ appointmentId: z.string().min(1).optional(), patientId: z.string().min(1).optional() });
const RECORDING_ACTIONS = ["start", "pause", "resume", "stop"] as const;
const MAX_SEGMENTS = 5000;
const NO_CONSENT = "Recording consent has not been recorded for this patient";

export function createConsultationService(repo: ConsultRepo, deps: ConsultDeps) {
  const parse = <T>(schema: z.ZodType<T, unknown>, raw: unknown): T => { const r = schema.safeParse(raw); if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid input"); return r.data; };
  const audit = (a: Actor, action: string, id: string, metadata: Record<string, unknown> = {}) => repo.audit({ action, actorId: a.userId, organizationId: a.orgId, resourceId: id, metadata });

  /** Author-only by default. Other doctors need clinical access to the PATIENT and then only see approved notes. Everyone else: 404. */
  async function load(actor: Actor, id: string): Promise<{ c: Consultation; access: "author" | "shared_read" }> {
    const c = await repo.get(id);
    if (!c || !actor.roles.includes("doctor")) throw new NotFoundError("Consultation not found");
    const level = await deps.patientAccess(actor, c.patientId); // also enforces "doctor is verified and active"
    if (level !== "clinical") throw new NotFoundError("Consultation not found");
    return { c, access: c.doctorUserId === actor.userId ? "author" : "shared_read" };
  }
  async function loadAuthor(actor: Actor, id: string, opts: { open?: boolean } = {}) {
    const { c, access } = await load(actor, id);
    if (access !== "author") throw new ForbiddenError("consultation:write");
    if (opts.open && c.status !== "in_progress") throw new ValidationError("This consultation is completed");
    return c;
  }

  return {
    async start(actor: Actor, raw: unknown): Promise<{ consultationId: string; created: boolean }> {
      if (!actor.roles.includes("doctor")) throw new ForbiddenError("consultation:write");
      const input = parse(startInput, raw);
      let base: { appointmentId: string | null; patientId: string; organizationId: string | null; mode: string };
      if (input.appointmentId) {
        const a = await repo.appointment(input.appointmentId);
        if (!a || a.doctorUserId !== actor.userId) throw new NotFoundError("Appointment not found");
        if (a.status !== "checked_in" && a.status !== "in_progress") throw new ValidationError("Check the patient in before starting the consultation");
        base = { appointmentId: a.id, patientId: a.patientId, organizationId: a.organizationId, mode: a.mode };
      } else if (input.patientId) {
        base = { appointmentId: null, patientId: input.patientId, organizationId: actor.orgId, mode: "in_person" };
      } else throw new ValidationError("Provide an appointment or a patient");
      if ((await deps.patientAccess(actor, base.patientId)) !== "clinical") throw new NotFoundError(input.appointmentId ? "Appointment not found" : "Patient not found");
      const { consultation, created } = await repo.createOrGet({ ...base, doctorUserId: actor.userId, createdBy: actor.userId });
      if (created) await audit(actor, "consultation.started", consultation.id, { walkIn: !base.appointmentId });
      return { consultationId: consultation.id, created };
    },

    async getWorkspace(actor: Actor, id: string): Promise<Workspace> {
      const { c, access } = await load(actor, id);
      const [patient, consentOk, note] = await Promise.all([deps.patientContext(c.patientId), deps.hasRecordingConsent(c.patientId), repo.getNote(id)]);
      await audit(actor, "consultation.viewed", id, { access });
      const base = { consultation: c, patient, consent: { recording: consentOk } };
      if (access === "shared_read") return { ...base, access, note: note?.status === "approved" ? note : null };
      const [segments, recording] = await Promise.all([repo.listSegments(id), repo.activeSession(id)]);
      return { ...base, access, note, segments, recording, warnings: vitalWarnings(note?.content.vitals ?? null) };
    },

    async addSegment(actor: Actor, id: string, raw: unknown) {
      await loadAuthor(actor, id, { open: true });
      const s = parse(segmentInput, raw);
      if ((await repo.listSegments(id)).length >= MAX_SEGMENTS) throw new ValidationError("Transcript is too long");
      return repo.addSegment(id, { ...s, createdBy: actor.userId });
    },

    async updateSegment(actor: Actor, id: string, segmentId: string, raw: unknown) {
      await loadAuthor(actor, id, { open: true });
      const patch = parse(segmentPatch, raw);
      if (!(await repo.getSegment(id, segmentId))) throw new NotFoundError("Segment not found");
      const seg = await repo.updateSegment(id, segmentId, patch, actor.userId);
      if (patch.text !== undefined) await audit(actor, "transcript.edited", id, { segmentId });
      return seg;
    },

    async saveNote(actor: Actor, id: string, input: { baseVersion: number; content: unknown; amendmentReason?: string }) {
      const c = await loadAuthor(actor, id);
      if (c.status === "cancelled") throw new ValidationError("This consultation was cancelled");
      if (!Number.isInteger(input.baseVersion) || input.baseVersion < 0) throw new ValidationError("Invalid base version");
      const existing = await repo.getNote(id);
      const content = carryProvenance(existing?.content, parseNoteInput(input.content));
      let kind: "edit" | "amendment" = "edit"; let summary: string | undefined;
      if (existing?.status === "approved") {
        const reason = input.amendmentReason?.trim();
        if (!reason) throw new ValidationError("An amendment reason is required to change an approved note");
        if (reason.length < 10) throw new ValidationError("Amendment reason must be at least 10 characters");
        kind = "amendment"; summary = reason;
      }
      const { version } = await repo.saveVersion({ consultationId: id, baseVersion: input.baseVersion, content, authorId: actor.userId, kind, summary });
      await audit(actor, "note.saved", id, { version, kind });
      return { version, warnings: vitalWarnings(content.vitals) };
    },

    /** Approval is explicit and attributed. It never happens implicitly (e.g. on complete). */
    async approveNote(actor: Actor, id: string) {
      await loadAuthor(actor, id);
      const note = await repo.getNote(id);
      if (!note || documentedCount(note.content) === 0) throw new ValidationError("Nothing to approve: document at least one section first");
      if (note.status === "approved") throw new ValidationError("This note is already approved");
      if (!(await repo.approveNote(id, actor.userId))) throw new ValidationError("The note was changed by someone else; reload");
      await audit(actor, "note.approved", id, { version: note.currentVersion });
    },

    async listVersions(actor: Actor, id: string) { await loadAuthor(actor, id); return repo.listVersions(id); },
    async getVersion(actor: Actor, id: string, version: number) {
      await loadAuthor(actor, id);
      const v = await repo.getVersion(id, version);
      if (!v) throw new NotFoundError("Version not found");
      return v;
    },

    /** Consent is verified server-side at start AND resume. Stopping is always allowed. No audio is captured until STT is configured (M8). */
    async recording(actor: Actor, id: string, action: (typeof RECORDING_ACTIONS)[number]) {
      if (!RECORDING_ACTIONS.includes(action)) throw new ValidationError("Unknown recording action");
      const c = await loadAuthor(actor, id, { open: true });
      const active = await repo.activeSession(id);
      let status: string;
      if (action === "start") {
        if (!(await deps.hasRecordingConsent(c.patientId))) throw new ValidationError(NO_CONSENT);
        if (active) throw new ConflictError("A recording is already open for this consultation");
        await repo.startSession({ consultationId: id, startedBy: actor.userId }); status = "active";
      } else {
        if (!active) throw new ValidationError("No recording is open");
        if (action === "pause") { if (!(await repo.setSessionStatus(active.id, "active", "paused"))) throw new ValidationError("The recording is not running"); status = "paused"; }
        else if (action === "resume") {
          if (!(await deps.hasRecordingConsent(c.patientId))) throw new ValidationError(NO_CONSENT);
          if (!(await repo.setSessionStatus(active.id, "paused", "active"))) throw new ValidationError("The recording is not paused"); status = "active";
        } else { if (!(await repo.setSessionStatus(active.id, active.status, "stopped", "manual"))) throw new ValidationError("The recording already changed state"); status = "stopped"; }
      }
      await audit(actor, `recording.${action}`, id);
      return { status };
    },

    async complete(actor: Actor, id: string) {
      const c = await loadAuthor(actor, id);
      if (c.status !== "in_progress") throw new ValidationError("This consultation is already completed");
      await repo.complete(id);
      await audit(actor, "consultation.completed", id);
    },
  };
}
