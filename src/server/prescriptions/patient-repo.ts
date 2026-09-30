import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { auditEvents, patients, prescriptions, users } from "@/db/schema";
import type { PatientRxRepo, PatientRxRow } from "./patient-view";

const UUID = /^[0-9a-f-]{36}$/i;
const SEALED = ["finalized", "superseded", "cancelled"];
const sel = { id: prescriptions.id, code: prescriptions.code, status: prescriptions.status, patientId: prescriptions.patientId, doctorName: users.fullName, finalizedAt: prescriptions.finalizedAt };

export function drizzlePatientRxRepo(db: Db = getDb()): PatientRxRepo {
  return {
    async patientIdForUser(userId) { const [p] = await db.select({ id: patients.id }).from(patients).where(eq(patients.userId, userId)).limit(1); return p?.id ?? null; },
    async listFinalForPatient(pid) { return (await db.select(sel).from(prescriptions).innerJoin(users, eq(users.id, prescriptions.doctorUserId)).where(and(eq(prescriptions.patientId, pid), inArray(prescriptions.status, SEALED)))) as PatientRxRow[]; },
    async find(id) {
      if (!UUID.test(id)) return null;
      const [r] = await db.select(sel).from(prescriptions).innerJoin(users, eq(users.id, prescriptions.doctorUserId)).where(and(eq(prescriptions.id, id), inArray(prescriptions.status, SEALED))).limit(1);
      return (r as PatientRxRow) ?? null;
    },
    async audit(e) { await db.insert(auditEvents).values({ action: e.action, actorId: e.actorId, resourceType: "prescription", resourceId: e.resourceId, metadata: e.metadata ?? {} }); },
  };
}
