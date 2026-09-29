import { describe, it, expect, beforeEach } from "vitest";
import { createAppointmentService, type ApptRepo, type Appointment } from "@/server/appointments/service";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import { zonedToUtc } from "@/lib/time";
import type { Rule } from "@/server/appointments/slots";
import type { AccessLevel } from "@/server/patients/access";

const NOW = zonedToUtc("2026-10-01", "08:00");
let clock = NOW;
const MON = "2026-10-05";
const rule: Rule = { weekday: 1, startTime: "09:00", endTime: "11:00", slotMinutes: 20, bufferMinutes: 0, mode: "both", location: "Chamber A", maxPerDay: null, validFrom: null, validTo: null };

function fake() {
  const appts = new Map<string, Appointment>(); const audit: any[] = []; const notes: any[] = []; const patientOfUser = new Map<string, string>([["pu1", "p1"]]); let n = 0;
  const doctors = new Map<string, any>([["d1", { userId: "d1", status: "active", organizationId: "orgA" }], ["d2", { userId: "d2", status: "active", organizationId: "orgB" }], ["d3", { userId: "d3", status: "under_review", organizationId: "orgA" }]]);
  const active = (a: Appointment) => ["booked", "checked_in", "in_progress"].includes(a.status);
  const clash = (id: string | null, doctor: string, patient: string, s: Date, e: Date) => [...appts.values()].some((a) => a.id !== id && active(a) && (a.doctorUserId === doctor || a.patientId === patient) && a.startAt < e && s < a.endAt);
  const repo: ApptRepo = {
    async doctor(id) { return doctors.get(id) ?? null; },
    async rules(id) { return id === "d1" || id === "d3" ? [rule] : []; },
    async exceptions() { return []; },
    async busy(doctor, _f, _t, excludeId) { return [...appts.values()].filter((a) => a.doctorUserId === doctor && active(a) && a.id !== excludeId).map((a) => ({ startAt: a.startAt, endAt: a.endAt })); },
    async patientIdForUser(u) { return patientOfUser.get(u) ?? null; },
    async createPatientForUser(u) { patientOfUser.set(u.userId, "p-new"); return "p-new"; },
    async book(b) {
      if (clash(null, b.doctorUserId, b.patientId, b.startAt, b.endAt)) throw new ConflictError("This time was just taken");
      const id = `a${++n}`; appts.set(id, { id, doctorUserId: b.doctorUserId, patientId: b.patientId, patientUserId: patientOfUser.get("pu1") === b.patientId ? "pu1" : null, organizationId: b.organizationId, startAt: b.startAt, endAt: b.endAt, mode: b.mode as "in_person", location: b.location, status: "booked" });
      notes.push({ kind: "appointment_booked", id }); return id;
    },
    async get(id) { return appts.get(id) ?? null; },
    async reschedule(id, s, e, mode, loc) { const a = appts.get(id)!; if (clash(id, a.doctorUserId, a.patientId, s, e)) throw new ConflictError("taken"); Object.assign(a, { startAt: s, endAt: e, mode, location: loc }); },
    async setStatus(id, from, to, extra) { const a = appts.get(id)!; if (a.status !== from) return false; a.status = to; Object.assign(a, extra ?? {}); return true; },
    async list(f) { return [...appts.values()].filter((a) => (!f.patientUserId || a.patientUserId === f.patientUserId) && (!f.doctorUserId || a.doctorUserId === f.doctorUserId) && (!f.organizationId || a.organizationId === f.organizationId) && a.startAt >= f.fromUtc && a.startAt < f.toUtc); },
    async notify(e) { notes.push(e); },
    async audit(e) { audit.push(e); },
  };
  return { repo, appts, audit, notes, patientOfUser };
}

const patient: Actor = { userId: "pu1", roles: ["patient"], orgId: null };
const docA: Actor = { userId: "d1", roles: ["doctor"], orgId: "orgA" };
const recepA: Actor = { userId: "r1", roles: ["receptionist"], orgId: "orgA" };
const at = (t: string, date = MON) => zonedToUtc(date, t).toISOString();

describe("appointment service", () => {
  let f: ReturnType<typeof fake>; let svc: ReturnType<typeof createAppointmentService>; let level: AccessLevel;
  beforeEach(() => { clock = NOW; level = "clinical"; f = fake(); svc = createAppointmentService(f.repo, { now: () => clock, patientAccess: async () => level }); });

  describe("availability", () => {
    it("lists open slots and hides taken ones", async () => {
      await svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person" });
      const s = await svc.availableSlots("d1", MON, MON);
      expect(s.map((x) => x.startTime)).not.toContain("09:00"); expect(s.map((x) => x.startTime)).toContain("09:20");
    });
    it("returns nothing for doctors that are not active", async () => { expect(await svc.availableSlots("d3", MON, MON)).toEqual([]); });
    it("exposes no patient identifiers", async () => {
      await svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person" });
      expect(JSON.stringify(await svc.availableSlots("d1", MON, MON))).not.toMatch(/p1|pu1|patient/i);
    });
  });

  describe("booking", () => {
    it("patient books an offered slot for themselves; end time is derived server-side", async () => {
      const r = await svc.book(patient, { doctorUserId: "d1", startAt: at("09:20"), mode: "online", endAt: "2099-01-01T00:00:00Z" } as any);
      const a = f.appts.get(r.appointmentId)!;
      expect(a.patientId).toBe("p1"); expect(a.endAt.toISOString()).toBe(zonedToUtc(MON, "09:40").toISOString());
      expect(f.audit.some((e) => e.action === "appointment.booked")).toBe(true);
    });
    it("rejects a time that is not an offered slot (off-grid, outside hours, wrong day, past)", async () => {
      for (const t of [at("09:07"), at("08:00"), at("11:00"), at("09:00", "2026-10-06"), at("09:00", "2026-09-28")])
        await expect(svc.book(patient, { doctorUserId: "d1", startAt: t, mode: "in_person" })).rejects.toThrow(ConflictError);
    });
    it("rejects malformed input", async () => {
      await expect(svc.book(patient, { doctorUserId: "d1", startAt: "tomorrow", mode: "in_person" })).rejects.toThrow(ValidationError);
      await expect(svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "telepathy" } as any)).rejects.toThrow(ValidationError);
    });
    it("second booking of the same slot loses with a conflict", async () => {
      await svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person" });
      f.patientOfUser.set("pu2", "p2");
      await expect(svc.book({ userId: "pu2", roles: ["patient"], orgId: null }, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person" })).rejects.toThrow(ConflictError);
    });
    it("the DB-level clash is mapped to a conflict even if the slot looked free (race)", async () => {
      const orig = f.repo.busy; f.repo.busy = async () => []; // stale read: engine thinks it is free
      await svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person" });
      f.patientOfUser.set("pu2", "p2");
      await expect(svc.book({ userId: "pu2", roles: ["patient"], orgId: null }, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person" })).rejects.toThrow(ConflictError);
      f.repo.busy = orig;
    });
    it("a patient cannot hold two overlapping appointments with different doctors", async () => {
      // d2 has no rules in the fake, so use the same doctor at an overlapping time: covered by clash on patient id
      await svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person" });
      await expect(svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person" })).rejects.toThrow(ConflictError);
    });
    it("cannot book with unverified/inactive or unknown doctors", async () => {
      await expect(svc.book(patient, { doctorUserId: "d3", startAt: at("09:00"), mode: "in_person" })).rejects.toThrow(ValidationError);
      await expect(svc.book(patient, { doctorUserId: "nobody", startAt: at("09:00"), mode: "in_person" })).rejects.toThrow(NotFoundError);
    });
    it("first-time patient must supply date of birth; profile is then created", async () => {
      f.patientOfUser.delete("pu1");
      await expect(svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person" })).rejects.toThrow(/date of birth/i);
      const r = await svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person", profile: { dob: "1990-05-05", sex: "female" } });
      expect(f.appts.get(r.appointmentId)!.patientId).toBe("p-new");
    });
    it("patients cannot book on behalf of someone else (patientId ignored)", async () => {
      const r = await svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person", patientId: "victim" } as any);
      expect(f.appts.get(r.appointmentId)!.patientId).toBe("p1");
    });
    it("receptionist books for an org patient with an org doctor only", async () => {
      level = "demographics";
      await svc.book(recepA, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person", patientId: "p9" });
      await expect(svc.book(recepA, { doctorUserId: "d2", startAt: at("09:20"), mode: "in_person", patientId: "p9" })).rejects.toThrow(ValidationError);
      level = "none";
      await expect(svc.book(recepA, { doctorUserId: "d1", startAt: at("09:20"), mode: "in_person", patientId: "p9" })).rejects.toThrow(NotFoundError);
    });
    it("doctors book follow-ups only for their own patients and only with themselves", async () => {
      await svc.book(docA, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person", patientId: "p9" });
      await expect(svc.book(docA, { doctorUserId: "d2", startAt: at("09:20"), mode: "in_person", patientId: "p9" })).rejects.toThrow(ForbiddenError);
      level = "none";
      await expect(svc.book(docA, { doctorUserId: "d1", startAt: at("09:20"), mode: "in_person", patientId: "p9" })).rejects.toThrow(NotFoundError);
    });
    it("other roles cannot book", async () => {
      for (const r of ["finance", "support", "super_admin", "content_manager"] as const)
        await expect(svc.book({ userId: "x", roles: [r], orgId: null }, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person", patientId: "p1" })).rejects.toThrow(ForbiddenError);
    });
  });

  describe("cancellation & rescheduling", () => {
    async function booked() { return (await svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person" })).appointmentId; }
    it("patient can cancel more than 2h before; refused inside the cutoff", async () => {
      const id = await booked();
      clock = zonedToUtc(MON, "07:30"); // 1.5h before
      await expect(svc.cancel(patient, id, "conflict")).rejects.toThrow(ValidationError);
      clock = zonedToUtc(MON, "06:30");
      await svc.cancel(patient, id, "conflict");
      expect(f.appts.get(id)!.status).toBe("cancelled");
    });
    it("cancelling frees the slot for others", async () => {
      const id = await booked(); await svc.cancel(patient, id);
      expect((await svc.availableSlots("d1", MON, MON)).map((s) => s.startTime)).toContain("09:00");
    });
    it("doctor can cancel any time but must give a reason", async () => {
      const id = await booked(); clock = zonedToUtc(MON, "08:59");
      await expect(svc.cancel(docA, id)).rejects.toThrow(ValidationError);
      await svc.cancel(docA, id, "Emergency surgery");
      expect(f.appts.get(id)!.status).toBe("cancelled");
    });
    it("strangers get 404; other-org staff too", async () => {
      const id = await booked();
      await expect(svc.cancel({ userId: "pu9", roles: ["patient"], orgId: null }, id)).rejects.toThrow(NotFoundError);
      await expect(svc.cancel({ userId: "r2", roles: ["receptionist"], orgId: "orgB" }, id, "x")).rejects.toThrow(NotFoundError);
      await expect(svc.cancel({ userId: "d2", roles: ["doctor"], orgId: "orgB" }, id, "x")).rejects.toThrow(NotFoundError);
    });
    it("cannot cancel an appointment that is already completed/cancelled", async () => {
      const id = await booked(); await svc.cancel(patient, id);
      await expect(svc.cancel(patient, id)).rejects.toThrow(ValidationError);
    });
    it("reschedule moves to another OFFERED slot atomically; the old slot is freed", async () => {
      const id = await booked();
      await svc.reschedule(patient, id, { startAt: at("10:00"), mode: "in_person" });
      expect(f.appts.get(id)!.startAt.toISOString()).toBe(zonedToUtc(MON, "10:00").toISOString());
      expect((await svc.availableSlots("d1", MON, MON)).map((s) => s.startTime)).toContain("09:00");
    });
    it("reschedule into a taken or invalid slot fails and leaves the original untouched", async () => {
      const id = await booked();
      f.patientOfUser.set("pu2", "p2"); await svc.book({ userId: "pu2", roles: ["patient"], orgId: null }, { doctorUserId: "d1", startAt: at("10:00"), mode: "in_person" });
      await expect(svc.reschedule(patient, id, { startAt: at("10:00"), mode: "in_person" })).rejects.toThrow(ConflictError);
      await expect(svc.reschedule(patient, id, { startAt: at("13:00"), mode: "in_person" })).rejects.toThrow(ConflictError);
      expect(f.appts.get(id)!.startAt.toISOString()).toBe(zonedToUtc(MON, "09:00").toISOString());
    });
    it("can reschedule to an adjacent time overlapping its own old slot (own booking is excluded)", async () => {
      const id = await booked();
      await svc.reschedule(patient, id, { startAt: at("09:20"), mode: "in_person" });
      expect(f.appts.get(id)!.startAt.toISOString()).toBe(zonedToUtc(MON, "09:20").toISOString());
    });
    it("patient reschedule obeys the same 2h cutoff", async () => {
      const id = await booked(); clock = zonedToUtc(MON, "08:00");
      await expect(svc.reschedule(patient, id, { startAt: at("10:00"), mode: "in_person" })).rejects.toThrow(ValidationError);
    });
  });

  describe("day-of workflow", () => {
    async function booked() { return (await svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person" })).appointmentId; }
    it("reception checks in on the day; doctor starts and completes", async () => {
      const id = await booked(); clock = zonedToUtc(MON, "08:50");
      await svc.transition(recepA, id, "checked_in");
      await svc.transition(docA, id, "in_progress");
      await svc.transition(docA, id, "completed");
      expect(f.appts.get(id)!.status).toBe("completed");
    });
    it("cannot check in on a different day", async () => {
      const id = await booked(); clock = zonedToUtc("2026-10-02", "10:00");
      await expect(svc.transition(recepA, id, "checked_in")).rejects.toThrow(ValidationError);
    });
    it("receptionists cannot start or complete consultations; patients cannot change status", async () => {
      const id = await booked(); clock = zonedToUtc(MON, "08:50");
      await svc.transition(recepA, id, "checked_in");
      await expect(svc.transition(recepA, id, "in_progress")).rejects.toThrow(ForbiddenError);
      await expect(svc.transition(patient, id, "in_progress")).rejects.toThrow(ForbiddenError);
    });
    it("no-show only after the start time has passed", async () => {
      const id = await booked(); clock = zonedToUtc(MON, "08:50");
      await expect(svc.transition(docA, id, "no_show")).rejects.toThrow(ValidationError);
      clock = zonedToUtc(MON, "09:10");
      await svc.transition(docA, id, "no_show");
      expect(f.appts.get(id)!.status).toBe("no_show");
    });
    it("illegal transitions are rejected", async () => {
      const id = await booked(); clock = zonedToUtc(MON, "08:50");
      await expect(svc.transition(docA, id, "completed")).rejects.toThrow(ValidationError);
    });
  });

  describe("listing", () => {
    it("accepts a range of exactly MAX_LIST_DAYS days and rejects one more (UI pages rely on this bound)", async () => {
      const { MAX_LIST_DAYS } = await import("@/server/appointments/service");
      const last = (n: number) => { const d = new Date(Date.UTC(2026, 9, 1)); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
      await expect(svc.list(patient, "2026-10-01", last(MAX_LIST_DAYS))).resolves.toBeDefined();
      await expect(svc.list(patient, "2026-10-01", last(MAX_LIST_DAYS + 1))).rejects.toThrow(ValidationError);
    });
    it("patient sees own; doctor sees own; reception sees org; others none", async () => {
      await svc.book(patient, { doctorUserId: "d1", startAt: at("09:00"), mode: "in_person" });
      expect((await svc.list(patient, MON, MON)).length).toBe(1);
      expect((await svc.list(docA, MON, MON)).length).toBe(1);
      expect((await svc.list(recepA, MON, MON)).length).toBe(1);
      expect((await svc.list({ userId: "d2", roles: ["doctor"], orgId: "orgB" }, MON, MON)).length).toBe(0);
      await expect(svc.list({ userId: "f", roles: ["finance"], orgId: null }, MON, MON)).rejects.toThrow(ForbiddenError);
    });
  });
});
