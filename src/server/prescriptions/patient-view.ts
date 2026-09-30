import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import { NotFoundError } from "@/server/errors";
import type { SealedCopy } from "./share";

export interface PatientRxRow { id: string; code: string; status: string; patientId: string; doctorName: string; finalizedAt: Date | null }
export interface PatientRxRepo {
  patientIdForUser(userId: string): Promise<string | null>;
  listFinalForPatient(patientId: string): Promise<PatientRxRow[]>;
  find(id: string): Promise<PatientRxRow | null>;
  audit(e: { action: string; actorId: string; resourceId: string; metadata?: Record<string, unknown> }): Promise<void>;
}

/** A patient may read the SEALED prescriptions issued to their own linked record — nothing else, never drafts. */
export function createPatientRxView(repo: PatientRxRepo, deps: { copy(id: string): Promise<SealedCopy> }) {
  const requirePatient = (a: Actor) => { if (!a.roles.includes("patient")) throw new ForbiddenError("prescription:read_own"); };
  return {
    async list(actor: Actor) {
      requirePatient(actor);
      const pid = await repo.patientIdForUser(actor.userId); if (!pid) return [];
      return (await repo.listFinalForPatient(pid)).sort((a, b) => (b.finalizedAt?.getTime() ?? 0) - (a.finalizedAt?.getTime() ?? 0))
        .map((r) => ({ id: r.id, code: r.code, status: r.status, doctorName: r.doctorName, issuedAt: r.finalizedAt }));
    },
    async get(actor: Actor, id: string) {
      requirePatient(actor);
      const pid = await repo.patientIdForUser(actor.userId);
      const r = pid ? await repo.find(id) : null;
      if (!r || r.patientId !== pid) throw new NotFoundError("Prescription not found");
      const copy = await deps.copy(id);
      await repo.audit({ action: "prescription.patient_viewed", actorId: actor.userId, resourceId: id });
      return copy;
    },
  };
}
