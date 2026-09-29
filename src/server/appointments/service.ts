import { z } from "zod";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import { addDays, isValidDate, utcToZoned, zonedToUtc } from "@/lib/time";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { AccessLevel } from "@/server/patients/access";
import { generateSlots, type Busy, type Exception, type Mode, type Rule, type Slot } from "./slots";
import { canTransition, type ApptStatus } from "./state";

export interface Appointment {
  id: string; doctorUserId: string; patientId: string; patientUserId: string | null; organizationId: string | null;
  startAt: Date; endAt: Date; mode: "in_person" | "online"; location: string | null; status: ApptStatus;
  reason?: string | null; doctorName?: string; patientName?: string;
}
export interface DoctorRow { userId: string; status: string; organizationId: string | null }
export interface ListFilter { patientUserId?: string; doctorUserId?: string; organizationId?: string; fromUtc: Date; toUtc: Date }
export interface AuditInput { action: string; actorId: string; organizationId?: string | null; resourceId: string; metadata?: Record<string, unknown> }

export interface ApptRepo {
  doctor(userId: string): Promise<DoctorRow | null>;
  rules(doctorUserId: string): Promise<Rule[]>;
  exceptions(doctorUserId: string, fromDate: string, toDate: string): Promise<Exception[]>;
  busy(doctorUserId: string, fromUtc: Date, toUtc: Date, excludeId?: string): Promise<Busy[]>;
  patientIdForUser(userId: string): Promise<string | null>;
  createPatientForUser(i: { userId: string; dob: string; sex: string }): Promise<string>;
  /** Must throw ConflictError when the DB exclusion constraint rejects an overlap (doctor or patient). */
  book(b: { doctorUserId: string; patientId: string; organizationId: string | null; startAt: Date; endAt: Date; mode: string; location: string | null; reason?: string; bookedBy: string; bookedVia: string }): Promise<string>;
  get(id: string): Promise<Appointment | null>;
  reschedule(id: string, startAt: Date, endAt: Date, mode: string, location: string | null): Promise<void>;
  setStatus(id: string, from: ApptStatus, to: ApptStatus, extra?: Record<string, unknown>): Promise<boolean>;
  list(f: ListFilter): Promise<Appointment[]>;
  notify(e: { kind: string; appointmentId: string }): Promise<void>;
  audit(e: AuditInput): Promise<void>;
}

export const PATIENT_CANCEL_CUTOFF_HOURS = 2;
/** Inclusive upper bound (in days between from and to) for list queries; pages must stay within it. */
export const MAX_LIST_DAYS = 62;
const bookSchema = z.object({
  doctorUserId: z.string().min(1), startAt: z.iso.datetime(), mode: z.enum(["in_person", "online"]),
  reason: z.string().trim().max(200).optional(), patientId: z.string().optional(),
  profile: z.object({ dob: z.string().refine(isValidDate, "Invalid date"), sex: z.enum(["male", "female", "other", "unknown"]) }).optional(),
});
const moveSchema = z.object({ startAt: z.iso.datetime(), mode: z.enum(["in_person", "online"]) });

export function createAppointmentService(repo: ApptRepo, deps: { now?: () => Date; patientAccess: (actor: Actor, patientId: string) => Promise<AccessLevel> }) {
  const now = deps.now ?? (() => new Date());
  const parse = <T>(schema: z.ZodType<T>, raw: unknown): T => { const r = schema.safeParse(raw); if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid input"); return r.data; };

  async function slotsFor(doctorUserId: string, fromDate: string, toDate: string, mode?: "in_person" | "online", excludeId?: string): Promise<Slot[]> {
    const [rules, exceptions, busy] = await Promise.all([
      repo.rules(doctorUserId), repo.exceptions(doctorUserId, fromDate, toDate),
      repo.busy(doctorUserId, zonedToUtc(fromDate, "00:00"), zonedToUtc(addDays(toDate, 1), "00:00"), excludeId),
    ]);
    return generateSlots({ rules, exceptions, busy, fromDate, toDate, now: now(), mode });
  }

  /** Server-side: the requested start MUST be one the engine offers. The end time is always derived here. */
  async function requireOfferedSlot(doctorUserId: string, startAt: Date, mode: "in_person" | "online", excludeId?: string): Promise<Slot> {
    const date = utcToZoned(startAt).date;
    const slot = (await slotsFor(doctorUserId, date, date, mode, excludeId)).find((s) => s.startAt.getTime() === startAt.getTime());
    if (!slot) throw new ConflictError("This time is not available");
    return slot;
  }

  async function loadFor(actor: Actor, id: string): Promise<{ appt: Appointment; as: "patient" | "doctor" | "reception" }> {
    const appt = await repo.get(id);
    if (appt) {
      if (actor.roles.includes("patient") && appt.patientUserId === actor.userId) return { appt, as: "patient" };
      if (actor.roles.includes("doctor") && appt.doctorUserId === actor.userId) return { appt, as: "doctor" };
      if (actor.roles.includes("receptionist") && appt.organizationId && appt.organizationId === actor.orgId) return { appt, as: "reception" };
    }
    throw new NotFoundError("Appointment not found"); // never reveal existence
  }
  const audit = (actor: Actor, action: string, id: string, metadata: Record<string, unknown> = {}) => repo.audit({ action, actorId: actor.userId, organizationId: actor.orgId, resourceId: id, metadata });
  const hoursUntil = (a: Appointment) => (a.startAt.getTime() - now().getTime()) / 3_600_000;

  return {
    async availableSlots(doctorUserId: string, fromDate: string, toDate: string, mode?: "in_person" | "online") {
      if (!isValidDate(fromDate) || !isValidDate(toDate) || fromDate > toDate) throw new ValidationError("Invalid date range");
      const d = await repo.doctor(doctorUserId);
      if (!d || d.status !== "active") return [];
      return slotsFor(doctorUserId, fromDate, toDate, mode);
    },

    async book(actor: Actor, raw: unknown) {
      const input = parse(bookSchema, raw);
      const via = actor.roles.includes("patient") ? "patient" : actor.roles.includes("receptionist") ? "staff" : actor.roles.includes("doctor") ? "doctor" : null;
      if (!via) throw new ForbiddenError("appointment:write");
      const doctor = await repo.doctor(input.doctorUserId);
      if (!doctor) throw new NotFoundError("Doctor not found");
      if (doctor.status !== "active") throw new ValidationError("This doctor is not accepting appointments");

      let patientId: string;
      if (via === "patient") {
        const own = await repo.patientIdForUser(actor.userId);
        if (own) patientId = own;
        else {
          if (!input.profile) throw new ValidationError("Date of birth is required for your first booking");
          patientId = await repo.createPatientForUser({ userId: actor.userId, ...input.profile });
        }
      } else {
        if (!input.patientId) throw new ValidationError("Select a patient");
        if (via === "doctor" && doctor.userId !== actor.userId) throw new ForbiddenError("appointment:write");
        const level = await deps.patientAccess(actor, input.patientId);
        if (level === "none" || (via === "doctor" && level !== "clinical")) throw new NotFoundError("Patient not found");
        if (via === "staff" && doctor.organizationId !== actor.orgId) throw new ValidationError("Doctor is not in your organization");
        patientId = input.patientId;
      }

      const slot = await requireOfferedSlot(doctor.userId, new Date(input.startAt), input.mode);
      const id = await repo.book({ doctorUserId: doctor.userId, patientId, organizationId: doctor.organizationId, startAt: slot.startAt, endAt: slot.endAt, mode: input.mode, location: slot.location, reason: input.reason, bookedBy: actor.userId, bookedVia: via });
      await audit(actor, "appointment.booked", id, { via, mode: input.mode });
      await repo.notify({ kind: "appointment_booked", appointmentId: id });
      return { appointmentId: id };
    },

    async cancel(actor: Actor, id: string, reason?: string) {
      const { appt, as } = await loadFor(actor, id);
      if (!canTransition(appt.status, "cancelled")) throw new ValidationError("This appointment can no longer be cancelled");
      if (as === "patient" && hoursUntil(appt) < PATIENT_CANCEL_CUTOFF_HOURS) throw new ValidationError(`Online cancellation closes ${PATIENT_CANCEL_CUTOFF_HOURS} hours before the appointment. Please contact the clinic.`);
      if (as !== "patient" && !reason?.trim()) throw new ValidationError("A reason is required");
      if (!(await repo.setStatus(id, appt.status, "cancelled", { cancelledBy: actor.userId, cancelReason: reason?.trim() ?? null, cancelledAt: now() }))) throw new ValidationError("The appointment was changed by someone else; reload");
      await audit(actor, "appointment.cancelled", id, { by: as });
      await repo.notify({ kind: "appointment_cancelled", appointmentId: id });
    },

    async reschedule(actor: Actor, id: string, raw: unknown) {
      const { appt, as } = await loadFor(actor, id);
      const input = parse(moveSchema, raw);
      if (appt.status !== "booked") throw new ValidationError("Only upcoming, not-yet-checked-in appointments can be rescheduled");
      if (as === "patient" && hoursUntil(appt) < PATIENT_CANCEL_CUTOFF_HOURS) throw new ValidationError(`Online changes close ${PATIENT_CANCEL_CUTOFF_HOURS} hours before the appointment.`);
      const slot = await requireOfferedSlot(appt.doctorUserId, new Date(input.startAt), input.mode, id);
      await repo.reschedule(id, slot.startAt, slot.endAt, input.mode, slot.location);
      await audit(actor, "appointment.rescheduled", id, { by: as });
      await repo.notify({ kind: "appointment_rescheduled", appointmentId: id });
    },

    async transition(actor: Actor, id: string, to: ApptStatus) {
      if (to === "cancelled") throw new ValidationError("Use the cancel action");
      const { appt, as } = await loadFor(actor, id);
      if ((to === "in_progress" || to === "completed") && as !== "doctor") throw new ForbiddenError("consultation:write");
      if ((to === "checked_in" || to === "no_show") && as === "patient") throw new ForbiddenError("appointment:write");
      if (!canTransition(appt.status, to)) throw new ValidationError(`Illegal transition ${appt.status} -> ${to}`);
      if (to === "checked_in" && utcToZoned(now()).date !== utcToZoned(appt.startAt).date) throw new ValidationError("Check-in is only available on the day of the appointment");
      if (to === "no_show" && now() < appt.startAt) throw new ValidationError("Cannot mark no-show before the appointment time");
      const ts = to === "checked_in" ? { checkedInAt: now() } : to === "in_progress" ? { startedAt: now() } : to === "completed" ? { completedAt: now() } : {};
      if (!(await repo.setStatus(id, appt.status, to, ts))) throw new ValidationError("The appointment was changed by someone else; reload");
      await audit(actor, "appointment.status_changed", id, { from: appt.status, to });
    },

    async list(actor: Actor, fromDate: string, toDate: string) {
      if (!isValidDate(fromDate) || !isValidDate(toDate) || fromDate > toDate || (Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000 > MAX_LIST_DAYS) throw new ValidationError("Invalid date range");
      const range = { fromUtc: zonedToUtc(fromDate, "00:00"), toUtc: zonedToUtc(addDays(toDate, 1), "00:00") };
      if (actor.roles.includes("patient")) return repo.list({ ...range, patientUserId: actor.userId });
      if (actor.roles.includes("doctor")) return repo.list({ ...range, doctorUserId: actor.userId });
      if (actor.roles.includes("receptionist")) return actor.orgId ? (await repo.list({ ...range, organizationId: actor.orgId })).map((a) => ({ ...a, reason: null })) : [];
      throw new ForbiddenError("appointment:read");
    },
  };
}
export type { Mode };
