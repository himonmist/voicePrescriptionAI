import { and, asc, eq, gt, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { appointments, auditEvents, availabilityExceptions, availabilitySchedules, doctorProfiles, notifications, patientDoctorRelationships, patients, users } from "@/db/schema";
import { decryptField, encryptField } from "@/lib/security/crypto";
import { normalizeName, normalizePhone, phoneBlindIndex } from "@/lib/security/pii";
import { ConflictError } from "@/server/errors";
import { newPatientCode } from "@/server/patients/code";
import type { ApptRepo, Appointment } from "./service";
import { ACTIVE_STATUSES, type ApptStatus } from "./state";

const codeOf = (e: unknown): string | undefined => (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
const isOverlap = (e: unknown) => codeOf(e) === "23P01";
const SLOT_TAKEN = "This time was just taken. Please pick another slot.";

/**
 * The visit reason is optional free text: if it cannot be decrypted (e.g. key mismatch) show it as unavailable instead of
 * failing the whole schedule. Logs no data. Do NOT copy this tolerance to clinical fields (allergies etc.) — those must fail loudly.
 */
function safeReason(enc: string | null): string | null {
  if (!enc) return null;
  try { return decryptField(enc); } catch { console.error("appointment reason could not be decrypted"); return null; }
}

export function drizzleApptRepo(db: Db = getDb()): ApptRepo {
  const select = {
    id: appointments.id, doctorUserId: appointments.doctorUserId, patientId: appointments.patientId, organizationId: appointments.organizationId,
    startAt: appointments.startAt, endAt: appointments.endAt, mode: appointments.mode, location: appointments.location, status: appointments.status, reasonEnc: appointments.reasonEnc,
    patientUserId: patients.userId, patientName: patients.fullName,
  };
  const toAppt = async (rows: (Record<string, unknown> & { reasonEnc: string | null })[]): Promise<Appointment[]> => {
    const ids = [...new Set(rows.map((r) => r.doctorUserId as string))];
    const names = ids.length ? await db.select({ id: users.id, n: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
    const nm = new Map(names.map((n) => [n.id, n.n]));
    return rows.map((r) => ({ ...(r as object), reason: safeReason(r.reasonEnc), doctorName: nm.get(r.doctorUserId as string) })) as unknown as Appointment[];
  };

  return {
    async doctor(userId) {
      const [d] = await db.select({ userId: doctorProfiles.userId, status: doctorProfiles.status, organizationId: doctorProfiles.organizationId }).from(doctorProfiles).where(eq(doctorProfiles.userId, userId)).limit(1);
      return d ?? null;
    },
    async rules(doctorUserId) {
      const rows = await db.select().from(availabilitySchedules).where(eq(availabilitySchedules.doctorUserId, doctorUserId));
      return rows.map((r) => ({ weekday: r.weekday, startTime: r.startTime, endTime: r.endTime, slotMinutes: r.slotMinutes, bufferMinutes: r.bufferMinutes, mode: r.mode as "both", location: r.location, maxPerDay: r.maxPerDay, validFrom: r.validFrom, validTo: r.validTo }));
    },
    async exceptions(doctorUserId, fromDate, toDate) {
      const rows = await db.select().from(availabilityExceptions).where(and(eq(availabilityExceptions.doctorUserId, doctorUserId), gte(availabilityExceptions.date, fromDate), sql`${availabilityExceptions.date} <= ${toDate}`));
      return rows.map((r) => ({ date: r.date, kind: r.kind as "holiday", startTime: r.startTime, endTime: r.endTime }));
    },
    async busy(doctorUserId, fromUtc, toUtc, excludeId) {
      const conds: SQL[] = [eq(appointments.doctorUserId, doctorUserId), inArray(appointments.status, [...ACTIVE_STATUSES]), lt(appointments.startAt, toUtc), gt(appointments.endAt, fromUtc)];
      if (excludeId) conds.push(ne(appointments.id, excludeId));
      return db.select({ startAt: appointments.startAt, endAt: appointments.endAt }).from(appointments).where(and(...conds));
    },
    async patientIdForUser(userId) {
      const [p] = await db.select({ id: patients.id }).from(patients).where(eq(patients.userId, userId)).limit(1);
      return p?.id ?? null;
    },
    async createPatientForUser({ userId, dob, sex }) {
      const [u] = await db.select({ name: users.fullName, phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
      if (!u) throw new Error("User not found");
      const phone = u.phone ? normalizePhone(u.phone) : null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const [p] = await db.insert(patients).values({
            patientCode: newPatientCode(), fullName: u.name, fullNameNorm: normalizeName(u.name), dob, sex, userId, createdBy: userId,
            phoneEnc: phone ? encryptField(phone) : null, phoneIdx: phone ? phoneBlindIndex(phone) : null,
          }).onConflictDoNothing({ target: patients.userId }).returning({ id: patients.id });
          if (p) return p.id;
          const [existing] = await db.select({ id: patients.id }).from(patients).where(eq(patients.userId, userId)).limit(1); // concurrent double-submit
          return existing.id;
        } catch (e) { if (codeOf(e) !== "23505" || attempt === 3) throw e; }
      }
      throw new Error("unreachable");
    },
    async book(b) {
      try {
        return await db.transaction(async (tx) => {
          const [a] = await tx.insert(appointments).values({
            doctorUserId: b.doctorUserId, patientId: b.patientId, organizationId: b.organizationId, startAt: b.startAt, endAt: b.endAt, mode: b.mode, location: b.location,
            reasonEnc: b.reason ? encryptField(b.reason) : null, bookedBy: b.bookedBy, bookedVia: b.bookedVia,
          }).returning({ id: appointments.id });
          // Booking establishes the patient–doctor relationship so the doctor can prepare for the visit.
          await tx.insert(patientDoctorRelationships).values({ patientId: b.patientId, doctorUserId: b.doctorUserId, kind: "treating", reason: "appointment booked", grantedBy: b.bookedBy }).onConflictDoNothing();
          return a.id;
        });
      } catch (e) { if (isOverlap(e)) throw new ConflictError(SLOT_TAKEN); throw e; }
    },
    async get(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const rows = await db.select(select).from(appointments).innerJoin(patients, eq(patients.id, appointments.patientId)).where(eq(appointments.id, id)).limit(1);
      return (await toAppt(rows))[0] ?? null;
    },
    async reschedule(id, startAt, endAt, mode, location) {
      try {
        const r = await db.update(appointments).set({ startAt, endAt, mode, location, updatedAt: new Date() }).where(and(eq(appointments.id, id), eq(appointments.status, "booked"))).returning({ id: appointments.id });
        if (r.length === 0) throw new ConflictError("The appointment was changed by someone else; reload");
      } catch (e) { if (isOverlap(e)) throw new ConflictError(SLOT_TAKEN); throw e; }
    },
    async setStatus(id, from, to, extra = {}) {
      const allowed = ["cancelledBy", "cancelReason", "cancelledAt", "checkedInAt", "startedAt", "completedAt"];
      const set: Record<string, unknown> = { status: to, updatedAt: new Date() };
      for (const k of allowed) if (k in extra) set[k] = extra[k];
      const r = await db.update(appointments).set(set).where(and(eq(appointments.id, id), eq(appointments.status, from as ApptStatus))).returning({ id: appointments.id });
      return r.length > 0;
    },
    async list(f) {
      const conds: SQL[] = [gte(appointments.startAt, f.fromUtc), lt(appointments.startAt, f.toUtc)];
      if (f.patientUserId) conds.push(eq(patients.userId, f.patientUserId));
      if (f.doctorUserId) conds.push(eq(appointments.doctorUserId, f.doctorUserId));
      if (f.organizationId) conds.push(eq(appointments.organizationId, f.organizationId));
      const rows = await db.select(select).from(appointments).innerJoin(patients, eq(patients.id, appointments.patientId)).where(and(...conds)).orderBy(asc(appointments.startAt)).limit(500);
      return toAppt(rows);
    },
    async notify(e) {
      const [a] = await db.select({ doctor: appointments.doctorUserId, patientUser: patients.userId }).from(appointments).innerJoin(patients, eq(patients.id, appointments.patientId)).where(eq(appointments.id, e.appointmentId)).limit(1);
      if (!a) return;
      const targets = [a.doctor, a.patientUser].filter((x): x is string => !!x);
      await db.insert(notifications).values(targets.map((userId) => ({ userId, kind: e.kind, payload: { appointmentId: e.appointmentId } })));
    },
    async audit(e) {
      await db.insert(auditEvents).values({ action: e.action, actorId: e.actorId, organizationId: e.organizationId ?? null, resourceType: "appointment", resourceId: e.resourceId, metadata: e.metadata ?? {} });
    },
  };
}
