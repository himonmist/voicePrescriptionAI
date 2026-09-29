import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/security/rbac";
import { drizzlePatientRepo } from "@/server/patients/drizzle-repo";
import { accessLevel, type AccessLevel } from "@/server/patients/access";

/** Same rule the patient service uses (relationship-based; doctors must be active), exposed to the appointment module. */
export function patientAccessFor(db: Db = getDb()) {
  const repo = drizzlePatientRepo(db);
  return async (actor: Actor, patientId: string): Promise<AccessLevel> => {
    const rec = await repo.getPatient(patientId);
    if (!rec) return "none";
    const level = accessLevel(actor, rec, await repo.relationshipsFor(patientId));
    return level === "clinical" && (await repo.doctorStatus(actor.userId)) !== "active" ? "none" : level;
  };
}
