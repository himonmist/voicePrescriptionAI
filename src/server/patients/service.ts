import { can, ForbiddenError, type Actor } from "@/lib/security/rbac";
import { normalizeName, phoneBlindIndex } from "@/lib/security/pii";
import { clinicalItemSchema, consentSchema, createPatientSchema, shareSchema, type CreatePatientInput } from "@/lib/validation/patient";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { accessLevel, isRelationshipActive, type AccessLevel, type PatientRef, type Relationship } from "./access";
import { findDuplicates, type DupCandidate, type DupProbe } from "./duplicates";

export const CURRENT_POLICY_VERSION = "2026-09-v1";

export interface PatientRecord { id: string; organizationId: string | null; patientCode: string; fullName: string; dob: string; sex: string; phone: string | null; email: string | null; address: string | null; emergencyContact: { name: string; phone: string; relation?: string } | null; userId: string | null; status: "active" | "merged" | "archived" }
export type Scope = { kind: "doctor"; doctorUserId: string } | { kind: "org"; orgId: string };
export interface AuditInput { action: string; actorId: string; organizationId?: string | null; resourceType: string; resourceId: string; metadata?: Record<string, unknown> }
export interface ClinicalItemRow { id: string; kind: string; description: string; severity: string | null; status: string; createdAt?: Date }
export interface ConsentRow { kind: string; granted: boolean; method: string; policyVersion: string; createdAt?: Date }

export interface PatientRepo {
  doctorStatus(userId: string): Promise<string | null>;
  isDoctorInOrg(doctorUserId: string, orgId: string): Promise<boolean>;
  candidates(scope: Scope, probe: DupProbe): Promise<DupCandidate[]>;
  createPatient(i: CreatePatientInput & { organizationId: string | null; createdBy: string; treatingDoctorUserId: string | null }): Promise<{ id: string; patientCode: string }>;
  getPatient(id: string): Promise<PatientRecord | null>;
  relationshipsFor(patientId: string): Promise<Relationship[]>;
  search(scope: Scope, q: string, limit: number, offset: number): Promise<{ id: string; patientCode: string; fullName: string; dob: string; sex: string }[]>;
  addConsent(c: { patientId: string; kind: string; granted: boolean; method: string; policyVersion: string; capturedBy: string; note?: string }): Promise<void>;
  latestConsents(patientId: string): Promise<ConsentRow[]>;
  addClinicalItem(i: { patientId: string; kind: string; description: string; severity?: string; recordedBy: string }): Promise<string>;
  listClinicalItems(patientId: string): Promise<ClinicalItemRow[]>;
  setClinicalItemStatus(patientId: string, itemId: string, status: string, reason: string): Promise<boolean>;
  grantAccess(g: { patientId: string; doctorUserId: string; reason: string; grantedBy: string; expiresAt: Date }): Promise<void>;
  revokeAccess(patientId: string, doctorUserId: string, revokedBy: string): Promise<boolean>;
  merge(m: { sourceId: string; targetId: string; mergedBy: string; reason: string }): Promise<void>;
  audit(e: AuditInput): Promise<void>;
}

export interface PatientView { level: AccessLevel; patient: PatientRecord; clinical?: { items: ClinicalItemRow[]; consents: ConsentRow[] } }

export function createPatientService(repo: PatientRepo) {
  const v = <T>(r: { success: boolean; data?: T; error?: { issues: { message: string }[] } }): T => {
    if (!r.success) throw new ValidationError(r.error!.issues[0]?.message ?? "Invalid input");
    return r.data as T;
  };

  /** Doctors must be verified+active for ANY patient operation; suspension takes effect immediately. */
  async function isActiveDoctor(actor: Actor) { return actor.roles.includes("doctor") && (await repo.doctorStatus(actor.userId)) === "active"; }

  async function resolve(actor: Actor, patientId: string): Promise<{ ref: PatientRecord; level: AccessLevel; rels: Relationship[] }> {
    const rec = await repo.getPatient(patientId);
    if (!rec) throw new NotFoundError("Patient not found");
    const rels = await repo.relationshipsFor(patientId);
    let level = accessLevel(actor, rec as PatientRef, rels);
    if (level === "clinical" && !(await isActiveDoctor(actor))) level = "none";
    if (level === "none") throw new NotFoundError("Patient not found"); // never reveal existence
    return { ref: rec, level, rels };
  }
  const requireClinical = (level: AccessLevel) => { if (level !== "clinical") throw new ForbiddenError("patient:write"); };
  const isTreating = (actor: Actor, rels: Relationship[]) => rels.some((r) => r.kind === "treating" && r.doctorUserId === actor.userId && isRelationshipActive(r));

  return {
    async createPatient(actor: Actor, raw: unknown, opts: { confirmNotDuplicate?: boolean; forDoctorUserId?: string } = {}) {
      if (!can(actor, "patient:write")) throw new ForbiddenError("patient:write");
      const input = v(createPatientSchema.safeParse(raw));
      let scope: Scope; let treating: string | null; const orgId = actor.orgId;
      if (actor.roles.includes("doctor")) {
        if (!(await isActiveDoctor(actor))) throw new ForbiddenError("patient:write");
        scope = { kind: "doctor", doctorUserId: actor.userId }; treating = actor.userId;
      } else if (actor.roles.includes("receptionist")) {
        if (!orgId) throw new ForbiddenError("patient:write");
        const d = opts.forDoctorUserId;
        if (!d) throw new ValidationError("Select the doctor this patient is registered for");
        if (!(await repo.isDoctorInOrg(d, orgId)) || (await repo.doctorStatus(d)) !== "active") throw new ValidationError("Doctor is not available in your organization");
        scope = { kind: "org", orgId }; treating = d;
      } else throw new ForbiddenError("patient:write");

      const probe: DupProbe = { fullNameNorm: normalizeName(input.fullName), dob: input.dob, phoneIdx: input.phone ? phoneBlindIndex(input.phone) : null };
      const dups = findDuplicates(probe, await repo.candidates(scope, probe));
      if (dups.length && !opts.confirmNotDuplicate) throw new ConflictError("Possible duplicate patient", dups);

      const created = await repo.createPatient({ ...input, organizationId: orgId, createdBy: actor.userId, treatingDoctorUserId: treating });
      await repo.audit({ action: "patient.created", actorId: actor.userId, organizationId: orgId, resourceType: "patient", resourceId: created.id, metadata: { duplicateOverride: dups.length > 0 } });
      return { patientId: created.id, patientCode: created.patientCode };
    },

    async getPatient(actor: Actor, patientId: string): Promise<PatientView> {
      const { ref, level } = await resolve(actor, patientId);
      await repo.audit({ action: "patient.viewed", actorId: actor.userId, organizationId: actor.orgId, resourceType: "patient", resourceId: patientId, metadata: { level } });
      const base: PatientView = { level, patient: ref };
      if (level === "demographics") return base;
      const [items, consents] = await Promise.all([repo.listClinicalItems(patientId), repo.latestConsents(patientId)]);
      return { ...base, clinical: { items, consents } };
    },

    async search(actor: Actor, q: string, page = 1) {
      const term = (q ?? "").trim();
      if (term.length < 2) throw new ValidationError("Enter at least 2 characters");
      let scope: Scope;
      if (actor.roles.includes("doctor") && (await isActiveDoctor(actor))) scope = { kind: "doctor", doctorUserId: actor.userId };
      else if (actor.roles.includes("receptionist") && actor.orgId) scope = { kind: "org", orgId: actor.orgId };
      else throw new ForbiddenError("patient:read");
      return repo.search(scope, term, 25, (Math.max(1, page) - 1) * 25);
    },

    async recordConsent(actor: Actor, patientId: string, raw: unknown) {
      const { level } = await resolve(actor, patientId);
      const c = v(consentSchema.safeParse(raw));
      if (level === "self" && c.method !== "digital") throw new ValidationError("Patients record consent digitally");
      await repo.addConsent({ patientId, ...c, policyVersion: CURRENT_POLICY_VERSION, capturedBy: actor.userId });
      await repo.audit({ action: "patient.consent_recorded", actorId: actor.userId, organizationId: actor.orgId, resourceType: "patient", resourceId: patientId, metadata: { kind: c.kind, granted: c.granted, method: c.method } });
    },

    /** Internal gate for the consultation module: consent is never assumed. */
    async hasActiveConsent(patientId: string, kind: string) {
      return (await repo.latestConsents(patientId)).find((c) => c.kind === kind)?.granted === true;
    },

    async addClinicalItem(actor: Actor, patientId: string, raw: unknown) {
      const { level } = await resolve(actor, patientId);
      requireClinical(level);
      const i = v(clinicalItemSchema.safeParse(raw));
      const id = await repo.addClinicalItem({ patientId, ...i, recordedBy: actor.userId });
      await repo.audit({ action: "patient.clinical_item_added", actorId: actor.userId, organizationId: actor.orgId, resourceType: "patient", resourceId: patientId, metadata: { kind: i.kind } });
      return id;
    },

    async setClinicalItemStatus(actor: Actor, patientId: string, itemId: string, status: "resolved" | "entered_in_error", reason: string) {
      if (!reason?.trim()) throw new ValidationError("A reason is required");
      const { level } = await resolve(actor, patientId);
      requireClinical(level);
      if (!(await repo.setClinicalItemStatus(patientId, itemId, status, reason.trim()))) throw new NotFoundError("Item not found");
      await repo.audit({ action: "patient.clinical_item_status", actorId: actor.userId, organizationId: actor.orgId, resourceType: "patient", resourceId: patientId, metadata: { itemId, status } });
    },

    async shareAccess(actor: Actor, patientId: string, raw: unknown) {
      const { level, rels } = await resolve(actor, patientId);
      if (level !== "clinical" || !isTreating(actor, rels)) throw new ForbiddenError("patient:write");
      const s = v(shareSchema.safeParse(raw));
      if (s.doctorUserId === actor.userId) throw new ValidationError("You already have access");
      if ((await repo.doctorStatus(s.doctorUserId)) !== "active") throw new ValidationError("Recipient must be a verified, active doctor");
      await repo.grantAccess({ patientId, doctorUserId: s.doctorUserId, reason: s.reason, grantedBy: actor.userId, expiresAt: new Date(Date.now() + s.expiresInDays * 86_400_000) });
      await repo.audit({ action: "patient.access_granted", actorId: actor.userId, organizationId: actor.orgId, resourceType: "patient", resourceId: patientId, metadata: { to: s.doctorUserId, days: s.expiresInDays } });
    },

    async revokeAccess(actor: Actor, patientId: string, doctorUserId: string) {
      const { rels } = await resolve(actor, patientId);
      if (!isTreating(actor, rels) && actor.userId !== doctorUserId) throw new ForbiddenError("patient:write");
      const target = rels.find((r) => r.doctorUserId === doctorUserId && isRelationshipActive(r));
      if (target?.kind === "treating") throw new ValidationError("The treating relationship cannot be revoked here");
      if (!(await repo.revokeAccess(patientId, doctorUserId, actor.userId))) throw new NotFoundError("No active access to revoke");
      await repo.audit({ action: "patient.access_revoked", actorId: actor.userId, organizationId: actor.orgId, resourceType: "patient", resourceId: patientId, metadata: { from: doctorUserId } });
    },

    async mergePatients(actor: Actor, sourceId: string, targetId: string, reason: string) {
      if (sourceId === targetId) throw new ValidationError("Choose two different records");
      if ((reason ?? "").trim().length < 10) throw new ValidationError("Provide a reason (min 10 characters)");
      const [a, b] = [await resolve(actor, sourceId), await resolve(actor, targetId)];
      if (!isTreating(actor, a.rels) || !isTreating(actor, b.rels)) throw new ForbiddenError("patient:write");
      await repo.merge({ sourceId, targetId, mergedBy: actor.userId, reason: reason.trim() });
      await repo.audit({ action: "patient.merged", actorId: actor.userId, organizationId: actor.orgId, resourceType: "patient", resourceId: targetId, metadata: { sourceId } });
    },
  };
}
