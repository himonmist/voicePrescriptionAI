import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { patientAccessFor } from "@/server/appointments/access";
import { drizzlePatientRepo } from "@/server/patients/drizzle-repo";
import { NotFoundError } from "@/server/errors";
import type { ConsultDeps } from "./service";

/** Adapters from the patient module. Recording consent comes ONLY from the recorded consent history — never assumed. */
export function consultDepsFor(db: Db = getDb()): ConsultDeps {
  const patients = drizzlePatientRepo(db);
  return {
    patientAccess: patientAccessFor(db),
    async hasRecordingConsent(patientId) { return (await patients.latestConsents(patientId)).find((c) => c.kind === "recording")?.granted === true; },
    async patientContext(patientId) {
      const p = await patients.getPatient(patientId);
      if (!p) throw new NotFoundError("Patient not found");
      const items = await patients.listClinicalItems(patientId);
      return { name: p.fullName, dob: p.dob, sex: p.sex, allergies: items.filter((i) => i.kind === "allergy" && i.status === "active").map((i) => i.description) };
    },
  };
}
