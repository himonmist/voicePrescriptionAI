import { assertCan, type Actor } from "@/lib/security/rbac";

export type DoctorStatus = "registered" | "verification_pending" | "under_review" | "approved" | "rejected" | "active" | "suspended";

const TRANSITIONS: Record<DoctorStatus, DoctorStatus[]> = {
  registered: ["verification_pending"],
  verification_pending: ["under_review"],
  under_review: ["approved", "rejected"],
  approved: ["active", "suspended"],
  rejected: ["verification_pending"],
  active: ["suspended", "under_review"], // under_review = periodic re-verification
  suspended: ["active", "under_review"],
};

export const canTransition = (from: DoctorStatus, to: DoctorStatus) => TRANSITIONS[from]?.includes(to) ?? false;

export interface VerificationRepo {
  getStatus(doctorId: string): Promise<DoctorStatus | null>;
  setStatus(doctorId: string, status: DoctorStatus, reviewerId: string, notes?: string): Promise<void>;
  audit(e: { action: string; actorId: string; resourceType: string; resourceId: string; metadata?: Record<string, unknown> }): Promise<void>;
  notify(doctorId: string, kind: string): Promise<void>;
}

const NOTIFY: Partial<Record<DoctorStatus, string>> = { under_review: "doctor_under_review", approved: "doctor_approved", rejected: "doctor_rejected", suspended: "doctor_suspended", active: "doctor_activated" };

export function createVerificationService(repo: VerificationRepo) {
  async function move(doctorId: string, to: DoctorStatus, actor: Actor, notes?: string) {
    const from = await repo.getStatus(doctorId);
    if (!from) throw new Error("Doctor not found");
    if (!canTransition(from, to)) throw new Error(`Illegal transition ${from} -> ${to}`);
    await repo.setStatus(doctorId, to, actor.userId, notes);
    await repo.audit({ action: "doctor.status_changed", actorId: actor.userId, resourceType: "doctor_profile", resourceId: doctorId, metadata: { from, to } });
    const kind = NOTIFY[to]; if (kind) await repo.notify(doctorId, kind);
  }
  return {
    /** The doctor submitting their own credentials. Ownership is enforced by the caller resolving doctorId from the actor. */
    async submitForVerification(doctorId: string, actor: Actor) {
      if (!actor.roles.includes("doctor")) assertCan(actor, "doctor:verify");
      await move(doctorId, "verification_pending", actor);
    },
    async decide(doctorId: string, to: DoctorStatus, actor: Actor, notes?: string) {
      assertCan(actor, "doctor:verify");
      if (to === "rejected" && !notes?.trim()) throw new Error("Rejection requires review notes");
      await move(doctorId, to, actor, notes);
    },
    isVerified: (s: DoctorStatus) => s === "active",
  };
}
