import { z } from "zod";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import type { RateResult } from "@/lib/security/rate-limit";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { AccessLevel } from "@/server/patients/access";
import type { NoteContent } from "@/server/consultations/note";
import { screenPrescription, type Alert, type Interaction, type RefDrug } from "@/server/drugs/safety";
import { completenessIssues, parseContentInput, prefillFromNote, type PrescriptionContent } from "./content";
import { computeHash, signHash, verifySeal } from "./seal";

export type RxStatus = "draft" | "approved" | "finalized" | "superseded" | "cancelled";
export interface Rx {
  id: string; code: string; consultationId: string; patientId: string; doctorUserId: string; organizationId: string | null; status: RxStatus | string;
  currentVersion: number; supersedesId: string | null; supersededById: string | null; approvedAt: Date | null; approvedBy: string | null;
  finalizedAt: Date | null; finalVersion: number | null; contentHash: string | null; seal: string | null; cancelReason: string | null; amendReason: string | null;
}
export interface PatientFacts { name: string; dob: string; sex: string; allergies: string[]; pregnant: boolean | null }
export interface ConsultLite { id: string; doctorUserId: string; patientId: string; organizationId: string | null; status: string }
export interface VersionRow { version: number; kind: string; content: PrescriptionContent; authorId: string }
export interface AuditInput { action: string; actorId: string; organizationId?: string | null; resourceId: string; metadata?: Record<string, unknown> }

export interface RxRepo {
  consultation(id: string): Promise<ConsultLite | null>;
  noteContent(consultationId: string): Promise<NoteContent | null>;
  patientFacts(patientId: string): Promise<PatientFacts>;
  /** Atomic + idempotent: at most one LIVE (draft/approved/finalized) prescription per consultation. */
  createOrGet(i: { consultationId: string; patientId: string; doctorUserId: string; organizationId: string | null; content: PrescriptionContent; createdBy: string }): Promise<{ row: Rx; created: boolean }>;
  get(id: string): Promise<Rx | null>;
  latestContent(id: string): Promise<{ version: number; content: PrescriptionContent } | null>;
  getVersion(id: string, version: number): Promise<VersionRow | null>;
  /** Atomic optimistic lock; must throw ConflictError unless status is 'draft' and current version === baseVersion. */
  saveVersion(v: { id: string; baseVersion: number; content: PrescriptionContent; authorId: string }): Promise<{ version: number }>;
  setApproved(id: string, version: number, by: string): Promise<boolean>;
  reopen(id: string): Promise<boolean>;
  finalize(id: string, f: { version: number; finalizedAt: Date; hash: string; seal: string }): Promise<boolean>;
  /** One transaction: original → superseded, new draft (fresh code) linked to it with `content` as version 1. Null if the original is not finalized. */
  amend(id: string, a: { reason: string; by: string; content: PrescriptionContent }): Promise<{ id: string; code: string } | null>;
  cancel(id: string, reason: string, by: string): Promise<boolean>;
  byCode(code: string): Promise<{ rx: Rx; doctor: { name: string; bmdc: string; specialty: string }; supersededByCode: string | null; content: PrescriptionContent | null } | null>;
  /** Doctor + patient details for the printed copy. */
  parties(rx: Rx): Promise<{ doctor: { name: string; bmdc: string; specialty: string; chamberAddress: string | null }; patient: { name: string; dob: string; sex: string; patientCode: string } }>;
  listByConsultation(consultationId: string): Promise<Rx[]>;
  audit(e: AuditInput): Promise<void>;
}

export interface RxDeps {
  patientAccess(actor: Actor, patientId: string): Promise<AccessLevel>;
  drugs: { screeningData(refIds: string[], names: string[]): Promise<{ refs: Record<string, RefDrug>; interactions: Interaction[]; coverage: { drugs: boolean; interactions: boolean }; description: { message: string; loaded: boolean; interactionsLoaded: boolean; sources: unknown[] } }> };
  checkPassword(userId: string, password: string): Promise<boolean>;
  limiter: { hit(key: string, limit: number, windowMs: number): RateResult | Promise<RateResult> };
  now?: () => Date;
}

const reasonSchema = z.string().transform((s) => s.trim()).pipe(z.string().min(10, "Give a reason of at least 10 characters").max(500));
const ageOf = (dob: string, now: Date) => Math.floor((now.getTime() - Date.parse(dob)) / 31_557_600_000);

export function createPrescriptionService(repo: RxRepo, deps: RxDeps) {
  const now = deps.now ?? (() => new Date());
  const audit = (a: Actor, action: string, id: string, metadata: Record<string, unknown> = {}) => repo.audit({ action, actorId: a.userId, organizationId: a.orgId, resourceId: id, metadata });
  const reason = (raw: unknown) => { const r = reasonSchema.safeParse(raw); if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "A reason is required"); return r.data; };

  async function loadAuthor(actor: Actor, id: string): Promise<Rx> {
    const rx = await repo.get(id);
    if (!rx || !actor.roles.includes("doctor") || rx.doctorUserId !== actor.userId) throw new NotFoundError("Prescription not found");
    if ((await deps.patientAccess(actor, rx.patientId)) !== "clinical") throw new NotFoundError("Prescription not found"); // suspended doctors lose access
    return rx;
  }

  /** Decision support against loaded reference data + the patient's recorded allergies. Never authorizes anything. */
  async function screen(rx: Rx, content: PrescriptionContent) {
    const facts = await repo.patientFacts(rx.patientId);
    const data = await deps.drugs.screeningData(content.items.map((i) => i.drugRefId).filter((x): x is string => !!x), content.items.map((i) => i.genericName));
    const result = screenPrescription({ items: content.items, refs: data.refs, interactions: data.interactions, allergies: facts.allergies, patient: { ageYears: Number.isFinite(ageOf(facts.dob, now())) ? ageOf(facts.dob, now()) : null, sex: facts.sex, pregnant: facts.pregnant }, coverage: data.coverage });
    const overridden = new Set(content.overrides.map((o) => o.alertKey));
    const overridesNeeded = result.alerts.filter((a: Alert) => a.requiresOverride && !overridden.has(a.key)).map((a) => a.key);
    return { alerts: result.alerts, limits: result.limits, overridesNeeded, description: data.description };
  }

  /** Everything that must be true before approval AND again at signing. Throws a ValidationError describing the first blocker. */
  async function assertReady(rx: Rx, content: PrescriptionContent, changedMessage?: string) {
    const issues = completenessIssues(content);
    if (issues.length) throw new ValidationError(issues.length > 1 ? `${issues[0]} (+${issues.length - 1} more)` : issues[0]);
    const s = await screen(rx, content);
    if (s.overridesNeeded.length) {
      const n = s.overridesNeeded.length;
      throw new ValidationError(changedMessage ?? `${n} safety alert${n > 1 ? "s" : ""} ${n > 1 ? "require" : "requires"} a documented override (or removing the medication) before this can proceed`);
    }
  }

  return {
    async createDraft(actor: Actor, consultationId: string) {
      if (!actor.roles.includes("doctor")) throw new ForbiddenError("prescription:write");
      const c = await repo.consultation(consultationId);
      if (!c || c.doctorUserId !== actor.userId || (await deps.patientAccess(actor, c.patientId)) !== "clinical") throw new NotFoundError("Consultation not found");
      if (c.status === "cancelled") throw new ValidationError("This consultation was cancelled");
      const [facts, note] = await Promise.all([repo.patientFacts(c.patientId), repo.noteContent(consultationId)]);
      const { row, created } = await repo.createOrGet({ consultationId, patientId: c.patientId, doctorUserId: actor.userId, organizationId: c.organizationId, content: prefillFromNote(note, facts.allergies), createdBy: actor.userId });
      if (created) await audit(actor, "prescription.created", row.id, { code: row.code });
      return { prescriptionId: row.id, code: row.code, created };
    },

    async get(actor: Actor, id: string) {
      const rx = await loadAuthor(actor, id);
      const latest = await repo.latestContent(id);
      if (!latest) throw new NotFoundError("Prescription not found");
      const content = rx.status === "finalized" || rx.status === "superseded" || rx.status === "cancelled" ? ((await repo.getVersion(id, rx.finalVersion ?? latest.version))?.content ?? latest.content) : latest.content;
      const screening = await screen(rx, content);
      await audit(actor, "prescription.viewed", id);
      return { prescription: rx, content, version: latest.version, issues: completenessIssues(content), screening };
    },

    async saveDraft(actor: Actor, id: string, input: { baseVersion: number; content: unknown }) {
      const rx = await loadAuthor(actor, id);
      if (rx.status === "approved") throw new ValidationError("Reopen the prescription to edit it");
      if (rx.status !== "draft") throw new ValidationError("This prescription is finalized and cannot be edited; amend it instead");
      if (!Number.isInteger(input.baseVersion) || input.baseVersion < 1) throw new ValidationError("Invalid base version");
      const { version } = await repo.saveVersion({ id, baseVersion: input.baseVersion, content: parseContentInput(input.content), authorId: actor.userId });
      await audit(actor, "prescription.saved", id, { version });
      return { version };
    },

    async approve(actor: Actor, id: string) {
      const rx = await loadAuthor(actor, id);
      if (rx.status !== "draft") throw new ValidationError("Only a draft can be approved");
      const latest = (await repo.latestContent(id))!;
      await assertReady(rx, latest.content);
      if (!(await repo.setApproved(id, latest.version, actor.userId))) throw new ValidationError("The prescription was changed by someone else; reload");
      await audit(actor, "prescription.approved", id, { version: latest.version, overrides: latest.content.overrides.length });
    },

    async reopen(actor: Actor, id: string) {
      const rx = await loadAuthor(actor, id);
      if (rx.status !== "approved") throw new ValidationError("Only an approved prescription can be reopened");
      if (!(await repo.reopen(id))) throw new ValidationError("The prescription was changed by someone else; reload");
      await audit(actor, "prescription.reopened", id);
    },

    /** Signing: explicit, password-confirmed, re-screened against CURRENT data, sealed, then immutable. */
    async finalize(actor: Actor, id: string, input: { password: string }) {
      const rx = await loadAuthor(actor, id);
      if (rx.status !== "approved") throw new ValidationError("Approve the prescription before signing it");
      if (!(await deps.limiter.hit(`rx-final:${actor.userId}`, 5, 15 * 60_000)).allowed) throw new ValidationError("Too many attempts. Try again in a few minutes.");
      if (!(await deps.checkPassword(actor.userId, input.password ?? ""))) { await audit(actor, "prescription.finalize_failed", id); throw new ValidationError("Password is incorrect"); }
      const latest = (await repo.latestContent(id))!;
      await assertReady(rx, latest.content, "The safety review changed since approval (new alert or new patient information). Reopen the prescription to review it again.");
      const finalizedAt = now();
      const hash = computeHash({ code: rx.code, doctorUserId: rx.doctorUserId, patientId: rx.patientId, consultationId: rx.consultationId, version: latest.version, finalizedAt: finalizedAt.toISOString(), content: latest.content });
      if (!(await repo.finalize(id, { version: latest.version, finalizedAt, hash, seal: signHash(hash) }))) throw new ValidationError("The prescription was changed by someone else; reload");
      await audit(actor, "prescription.finalized", id, { code: rx.code, version: latest.version });
      return { code: rx.code, contentHash: hash };
    },

    /** Finalized prescriptions are never edited. A correction creates a NEW prescription linked to the original, which becomes 'superseded'. */
    async amend(actor: Actor, id: string, input: { reason: unknown }) {
      const why = reason(input.reason);
      const rx = await loadAuthor(actor, id);
      if (rx.status !== "finalized") throw new ValidationError("Only a finalized prescription can be amended");
      const base = await repo.getVersion(id, rx.finalVersion!);
      if (!base) throw new NotFoundError("Prescription not found");
      const created = await repo.amend(id, { reason: why, by: actor.userId, content: { ...base.content, overrides: [] } }); // overrides must be re-justified against fresh screening
      if (!created) throw new ValidationError("The prescription was changed by someone else; reload");
      await audit(actor, "prescription.amended", id, { newId: created.id, newCode: created.code });
      return { prescriptionId: created.id, code: created.code };
    },

    async cancel(actor: Actor, id: string, input: { reason: unknown }) {
      const why = reason(input.reason);
      await loadAuthor(actor, id);
      if (!(await repo.cancel(id, why, actor.userId))) throw new ValidationError("This prescription is already closed");
      await audit(actor, "prescription.cancelled", id);
    },

    /** The sealed copy for printing/PDF. Always the FINALIZED version, labelled if it has since been superseded or cancelled. */
    async printable(actor: Actor, id: string) {
      const rx = await loadAuthor(actor, id);
      if (!rx.finalVersion || !rx.finalizedAt || !["finalized", "superseded", "cancelled"].includes(rx.status)) throw new ValidationError("Only a finalized prescription can be printed");
      const v = await repo.getVersion(id, rx.finalVersion);
      if (!v) throw new NotFoundError("Prescription not found");
      const { doctor, patient } = await repo.parties(rx);
      await audit(actor, "prescription.printed", id);
      return { code: rx.code, state: rx.status === "finalized" ? ("valid" as const) : (rx.status as "superseded" | "cancelled"), issuedAt: rx.finalizedAt.toISOString(), content: v.content, doctor, patient };
    },

    /** System path for the share-link service (authorization already done there). Not audited here; the share audit records the access. */
    async sealedCopy(id: string) {
      const rx = await repo.get(id);
      if (!rx || !rx.finalVersion || !rx.finalizedAt || rx.status !== "finalized") throw new NotFoundError("Prescription not found");
      const v = await repo.getVersion(id, rx.finalVersion);
      if (!v) throw new NotFoundError("Prescription not found");
      const { doctor, patient } = await repo.parties(rx);
      return { code: rx.code, state: "valid" as const, issuedAt: rx.finalizedAt.toISOString(), content: v.content, doctor, patient };
    },

    async listForConsultation(actor: Actor, consultationId: string) {
      const c = await repo.consultation(consultationId);
      if (!c || !actor.roles.includes("doctor") || c.doctorUserId !== actor.userId) throw new NotFoundError("Consultation not found");
      return repo.listByConsultation(consultationId);
    },

    /** PUBLIC. Authenticity only: who issued it, when, and whether the sealed content is unchanged. Never any patient information. */
    async verify(code: string) {
      if (!/^RX-[A-Z0-9]{4,12}$/.test(code ?? "")) throw new NotFoundError("Prescription not found");
      const r = await repo.byCode(code);
      if (!r || !["finalized", "superseded", "cancelled"].includes(r.rx.status) || !r.rx.finalizedAt) throw new NotFoundError("Prescription not found");
      let integrity: "valid" | "invalid" = "invalid";
      if (r.content && r.rx.contentHash && r.rx.seal && r.rx.finalVersion) {
        const h = computeHash({ code: r.rx.code, doctorUserId: r.rx.doctorUserId, patientId: r.rx.patientId, consultationId: r.rx.consultationId, version: r.rx.finalVersion, finalizedAt: r.rx.finalizedAt.toISOString(), content: r.content });
        integrity = h === r.rx.contentHash && verifySeal(h, r.rx.seal) ? "valid" : "invalid";
      }
      return { code: r.rx.code, status: r.rx.status === "finalized" ? ("valid" as const) : (r.rx.status as "superseded" | "cancelled"), integrity, doctorName: r.doctor.name, bmdc: r.doctor.bmdc, specialty: r.doctor.specialty, issuedAt: r.rx.finalizedAt.toISOString(), supersededByCode: r.rx.status === "superseded" ? r.supersededByCode : null };
    },
  };
}
