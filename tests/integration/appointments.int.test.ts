import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql, eq } from "drizzle-orm";
import { hasDb, setupTestDb } from "./db";
import { drizzleAuthRepo } from "@/server/auth/drizzle-repo";
import { drizzlePatientRepo } from "@/server/patients/drizzle-repo";
import { createPatientService } from "@/server/patients/service";
import { drizzleApptRepo } from "@/server/appointments/drizzle-repo";
import { drizzleAvailabilityRepo } from "@/server/appointments/drizzle-availability";
import { createAppointmentService } from "@/server/appointments/service";
import { createAvailabilityService } from "@/server/appointments/availability";
import { patientAccessFor } from "@/server/appointments/access";
import { listPublicDoctors, getPublicDoctor } from "@/server/directory/queries";
import { appointments, doctorProfiles, notifications, organizations, patients, patientDoctorRelationships } from "@/db/schema";
import { zonedToUtc } from "@/lib/time";
import { ConflictError } from "@/server/errors";
import type { Actor } from "@/lib/security/rbac";

const MON = "2026-10-05";
const NOW = zonedToUtc("2026-10-01", "08:00");
const at = (t: string, d = MON) => zonedToUtc(d, t).toISOString();

describe.skipIf(!hasDb)("appointments (real Postgres)", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  let svc: ReturnType<typeof createAppointmentService>;
  let avail: ReturnType<typeof createAvailabilityService>;
  let orgA: string; const U: Record<string, string> = {}; const P: Record<string, string> = {};

  beforeAll(async () => { process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString("base64"); ctx = await setupTestDb(); });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => {
    await ctx.db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update`);
    await ctx.db.execute(sql`TRUNCATE audit_events, appointments, availability_exceptions, availability_schedules, patient_merges, patient_clinical_items, patient_consents, patient_doctor_relationships, patients, notifications, doctor_credentials, doctor_profiles, sessions, user_roles, organization_memberships, organizations, users, rate_limits, user_recovery_codes CASCADE`);
    await ctx.db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update`);
    [{ id: orgA }] = await ctx.db.insert(organizations).values({ name: "A", slug: "a" }).returning();
    const auth = drizzleAuthRepo(ctx.db);
    for (const [k, status, pub] of [["d1", "active", true], ["d2", "active", true], ["d3", "under_review", true], ["d4", "active", false]] as const) {
      const u = await auth.createUser({ email: `${k}@x.com`, fullName: `Dr ${k}`, phone: "01712345678", passwordHash: "h", roles: ["doctor"] });
      await auth.createDoctorProfile({ userId: u.id, bmdcNumber: `B-${k}`, specialty: k === "d2" ? "Cardiology" : "General Practice" });
      await ctx.db.update(doctorProfiles).set({ status, publicProfile: pub, organizationId: orgA, consultationFeeBdt: 700, languages: ["Bangla"], bio: `Bio ${k}` }).where(eq(doctorProfiles.userId, u.id));
      U[k] = u.id;
    }
    for (const k of ["p1", "p2", "p3"]) {
      const u = await auth.createUser({ email: `${k}@x.com`, fullName: `Patient ${k}`, phone: `0171000000${k.slice(1)}`, passwordHash: "h", roles: ["patient"] });
      U[k] = u.id;
    }
    const recep = await auth.createUser({ email: "r@x.com", fullName: "Recep", phone: "01712345670", passwordHash: "h", roles: ["receptionist"] });
    U.r = recep.id;
    const patientSvc = createPatientService(drizzlePatientRepo(ctx.db));
    svc = createAppointmentService(drizzleApptRepo(ctx.db), { now: () => NOW, patientAccess: patientAccessFor(ctx.db) });
    avail = createAvailabilityService(drizzleAvailabilityRepo(ctx.db));
    for (const d of ["d1", "d2", "d3"]) await avail.replaceSchedule({ userId: U[d], roles: ["doctor"], orgId: orgA }, [{ weekday: 1, startTime: "09:00", endTime: "11:00", slotMinutes: 20, bufferMinutes: 0, mode: "both", location: "Chamber", maxPerDay: null }]);
    void patientSvc;
  });
  const pat = (k: string): Actor => ({ userId: U[k], roles: ["patient"], orgId: null });
  const book = (k: string, doc: string, t: string, extra: object = {}) => svc.book(pat(k), { doctorUserId: U[doc], startAt: at(t), mode: "in_person", profile: { dob: "1990-01-01", sex: "male" }, ...extra });

  describe("DB constraints (the last line of defence)", () => {
    const ins = (doctor: string, patient: string, s: string, e: string, status = "booked") => ctx.db.insert(appointments).values({ doctorUserId: U[doctor], patientId: P[patient], startAt: new Date(s), endAt: new Date(e), mode: "in_person", status, bookedBy: U.r, bookedVia: "staff" });
    beforeEach(async () => {
      for (const k of ["p1", "p2"]) { const [r] = await ctx.db.insert(patients).values({ patientCode: `T-${k}`, fullName: k, fullNameNorm: k, dob: "1990-01-01", createdBy: U.r }).returning(); P[k] = r.id; }
    });
    it("rejects overlapping appointments for the same doctor", async () => {
      await ins("d1", "p1", "2026-10-05T03:00:00Z", "2026-10-05T03:20:00Z");
      await expect(ins("d1", "p2", "2026-10-05T03:10:00Z", "2026-10-05T03:30:00Z")).rejects.toMatchObject({ cause: { code: "23P01" } });
    });
    it("allows back-to-back appointments (half-open ranges)", async () => {
      await ins("d1", "p1", "2026-10-05T03:00:00Z", "2026-10-05T03:20:00Z");
      await ins("d1", "p2", "2026-10-05T03:20:00Z", "2026-10-05T03:40:00Z");
    });
    it("cancelled / no-show appointments free the slot", async () => {
      await ins("d1", "p1", "2026-10-05T03:00:00Z", "2026-10-05T03:20:00Z", "cancelled");
      await ins("d1", "p2", "2026-10-05T03:00:00Z", "2026-10-05T03:20:00Z");
    });
    it("different doctors may run at the same time; one patient may not be in two places", async () => {
      await ins("d1", "p1", "2026-10-05T03:00:00Z", "2026-10-05T03:20:00Z");
      await ins("d2", "p2", "2026-10-05T03:00:00Z", "2026-10-05T03:20:00Z");
      await expect(ins("d2", "p1", "2026-10-05T03:10:00Z", "2026-10-05T03:30:00Z")).rejects.toMatchObject({ cause: { code: "23P01" } });
    });
    it("rejects inverted time ranges, unknown statuses and bad schedule rows", async () => {
      await expect(ins("d1", "p1", "2026-10-05T03:20:00Z", "2026-10-05T03:00:00Z")).rejects.toThrow();
      await expect(ins("d1", "p1", "2026-10-05T03:00:00Z", "2026-10-05T03:20:00Z", "weird")).rejects.toThrow();
      await expect(ctx.db.execute(sql`INSERT INTO availability_schedules (doctor_user_id, weekday, start_time, end_time, slot_minutes) VALUES (${U.d1}, 9, '09:00', '10:00', 20)`)).rejects.toThrow();
      await expect(ctx.db.execute(sql`INSERT INTO availability_schedules (doctor_user_id, weekday, start_time, end_time, slot_minutes) VALUES (${U.d1}, 1, '10:00', '09:00', 20)`)).rejects.toThrow();
    });
  });

  describe("concurrency", () => {
    it("12 simultaneous bookings of ONE slot: exactly one wins, the rest get a conflict", async () => {
      const ids = ["p1", "p2", "p3"]; 
      const auth = drizzleAuthRepo(ctx.db);
      const extra = await Promise.all(Array.from({ length: 9 }, (_, i) => auth.createUser({ email: `x${i}@x.com`, fullName: `X${i}`, phone: `018000000${i}`, passwordHash: "h", roles: ["patient"] })));
      const actors: Actor[] = [...ids.map(pat), ...extra.map((u) => ({ userId: u.id, roles: ["patient"] as const, orgId: null } as unknown as Actor))];
      const results = await Promise.allSettled(actors.map((a) => svc.book(a, { doctorUserId: U.d1, startAt: at("09:00"), mode: "in_person", profile: { dob: "1990-01-01", sex: "male" } })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((r) => r.status === "rejected")) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
      const rows = await ctx.db.select().from(appointments);
      expect(rows).toHaveLength(1);
    });
    it("concurrent bookings of DIFFERENT slots all succeed", async () => {
      const auth = drizzleAuthRepo(ctx.db);
      const us = await Promise.all(Array.from({ length: 5 }, (_, i) => auth.createUser({ email: `y${i}@x.com`, fullName: `Y${i}`, phone: `019000000${i}`, passwordHash: "h", roles: ["patient"] })));
      const times = ["09:00", "09:20", "09:40", "10:00", "10:20"];
      const rs = await Promise.allSettled(us.map((u, i) => svc.book({ userId: u.id, roles: ["patient"], orgId: null }, { doctorUserId: U.d1, startAt: at(times[i]), mode: "in_person", profile: { dob: "1990-01-01", sex: "male" } })));
      expect(rs.every((r) => r.status === "fulfilled")).toBe(true);
    });
  });

  describe("end-to-end booking", () => {
    it("creates a patient profile, links the doctor, encrypts the reason, notifies both, audits without PHI", async () => {
      const r = await book("p1", "d1", "09:00", { reason: "Chest pain since morning" });
      const [a] = await ctx.db.select().from(appointments).where(eq(appointments.id, r.appointmentId));
      expect(a.reasonEnc).toBeTruthy(); expect(a.reasonEnc).not.toContain("Chest");
      expect(a.endAt.toISOString()).toBe(zonedToUtc(MON, "09:20").toISOString());
      const [pt] = await ctx.db.select().from(patients).where(eq(patients.userId, U.p1));
      expect(pt.phoneEnc).toBeTruthy();
      const rel = await ctx.db.select().from(patientDoctorRelationships).where(eq(patientDoctorRelationships.patientId, pt.id));
      expect(rel.map((x) => x.doctorUserId)).toEqual([U.d1]);
      const n = await ctx.db.select().from(notifications).where(eq(notifications.kind, "appointment_booked"));
      expect(n.map((x) => x.userId).sort()).toEqual([U.d1, U.p1].sort());
      const audit = await ctx.db.execute(sql`SELECT metadata::text m FROM audit_events WHERE action='appointment.booked'`);
      expect(JSON.stringify(audit.rows)).not.toMatch(/Chest|Patient p1/);
    });
    it("the booked doctor can then open the patient record (relationship), others cannot", async () => {
      await book("p1", "d1", "09:00");
      const [pt] = await ctx.db.select().from(patients).where(eq(patients.userId, U.p1));
      const ps = createPatientService(drizzlePatientRepo(ctx.db));
      expect((await ps.getPatient({ userId: U.d1, roles: ["doctor"], orgId: orgA }, pt.id)).level).toBe("clinical");
      await expect(ps.getPatient({ userId: U.d2, roles: ["doctor"], orgId: orgA }, pt.id)).rejects.toThrow(/not found/i);
    });
    it("cancel then re-book the same slot; list is role-scoped and shows names to staff", async () => {
      const r = await book("p1", "d1", "09:00");
      await svc.cancel(pat("p1"), r.appointmentId, "change of plans");
      await book("p2", "d1", "09:00");
      const mine = await svc.list(pat("p2"), MON, MON);
      expect(mine).toHaveLength(1); expect(mine[0].doctorName).toBe("Dr d1");
      const docList = await svc.list({ userId: U.d1, roles: ["doctor"], orgId: orgA }, MON, MON);
      expect(docList.map((x) => x.status).sort()).toEqual(["booked", "cancelled"]); // history stays visible
      expect(docList.find((x) => x.status === "booked")?.patientName).toBe("Patient p2");
      expect(await svc.list({ userId: U.d2, roles: ["doctor"], orgId: orgA }, MON, MON)).toHaveLength(0);
    });
    it("an undecryptable visit reason degrades to null and never blanks the whole list", async () => {
      const a = await book("p1", "d1", "09:00", { reason: "Cough" }); await book("p2", "d1", "09:20", { reason: "Fever" });
      await ctx.db.execute(sql`UPDATE appointments SET reason_enc = 'not-valid-ciphertext' WHERE id = ${a.appointmentId}`);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const list = await svc.list({ userId: U.d1, roles: ["doctor"], orgId: orgA }, MON, MON);
      expect(list).toHaveLength(2);
      expect(list.find((x) => x.id === a.appointmentId)?.reason).toBeNull();
      expect(list.find((x) => x.id !== a.appointmentId)?.reason).toBe("Fever");
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Cough|not-valid/); // no data in logs
      spy.mockRestore();
    });
    it("reschedule is atomic and respects the constraint", async () => {
      const a = await book("p1", "d1", "09:00"); await book("p2", "d1", "09:20");
      await expect(svc.reschedule(pat("p1"), a.appointmentId, { startAt: at("09:20"), mode: "in_person" })).rejects.toThrow(ConflictError);
      await svc.reschedule(pat("p1"), a.appointmentId, { startAt: at("10:00"), mode: "online" });
      const [row] = await ctx.db.select().from(appointments).where(eq(appointments.id, a.appointmentId));
      expect(row.startAt.toISOString()).toBe(zonedToUtc(MON, "10:00").toISOString()); expect(row.mode).toBe("online");
    });
    it("receptionist books for a patient she can see; day-of workflow persists timestamps", async () => {
      const ps = createPatientService(drizzlePatientRepo(ctx.db));
      const recep: Actor = { userId: U.r, roles: ["receptionist"], orgId: orgA };
      await ctx.db.execute(sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (${orgA}, ${U.r}, 'receptionist')`);
      const { patientId } = await ps.createPatient(recep, { fullName: "Walk In", dob: "1980-02-02", sex: "female", phone: "01611111111" }, { forDoctorUserId: U.d1 });
      const r = await svc.book(recep, { doctorUserId: U.d1, startAt: at("10:00"), mode: "in_person", patientId });
      const clock = zonedToUtc(MON, "09:50");
      const svc2 = createAppointmentService(drizzleApptRepo(ctx.db), { now: () => clock, patientAccess: patientAccessFor(ctx.db) });
      await svc2.transition(recep, r.appointmentId, "checked_in");
      const doc: Actor = { userId: U.d1, roles: ["doctor"], orgId: orgA };
      await svc2.transition(doc, r.appointmentId, "in_progress"); await svc2.transition(doc, r.appointmentId, "completed");
      const [row] = await ctx.db.select().from(appointments).where(eq(appointments.id, r.appointmentId));
      expect(row.status).toBe("completed"); expect(row.checkedInAt && row.startedAt && row.completedAt).toBeTruthy();
    });
    it("cannot book with an inactive doctor or an unlisted time", async () => {
      await expect(book("p1", "d3", "09:00")).rejects.toThrow(/not accepting/i);
      await expect(book("p1", "d1", "09:05")).rejects.toThrow(ConflictError);
      await expect(book("p1", "d1", "09:00", { startAt: at("09:00", "2026-10-06") })).rejects.toThrow(ConflictError);
    });
  });

  describe("schedule + directory", () => {
    it("schedule round-trips; exceptions remove slots", async () => {
      const doc: Actor = { userId: U.d1, roles: ["doctor"], orgId: orgA };
      await avail.addException(doc, { date: MON, kind: "block", startTime: "09:00", endTime: "10:00" });
      const s = await svc.availableSlots(U.d1, MON, MON);
      expect(s.map((x) => x.startTime)).toEqual(["10:00", "10:20", "10:40"]);
      await avail.addException(doc, { date: MON, kind: "holiday" });
      expect(await svc.availableSlots(U.d1, MON, MON)).toEqual([]);
    });
    it("replacing the schedule is atomic (bad input leaves the old one intact)", async () => {
      const doc: Actor = { userId: U.d1, roles: ["doctor"], orgId: orgA };
      await expect(avail.replaceSchedule(doc, [{ weekday: 1, startTime: "10:00", endTime: "09:00", slotMinutes: 20, bufferMinutes: 0, mode: "both", location: null, maxPerDay: null }])).rejects.toThrow();
      expect((await svc.availableSlots(U.d1, MON, MON)).length).toBe(6);
    });
    it("directory lists only ACTIVE + PUBLIC doctors and never leaks contact details", async () => {
      const all = await listPublicDoctors(ctx.db, {});
      expect(all.rows.map((d) => d.fullName).sort()).toEqual(["Dr d1", "Dr d2"]); // d3 unverified, d4 not public
      expect(JSON.stringify(all)).not.toMatch(/@x\.com|0171|password/i);
      expect((await listPublicDoctors(ctx.db, { specialty: "Cardiology" })).rows.map((d) => d.fullName)).toEqual(["Dr d2"]);
      expect((await listPublicDoctors(ctx.db, { q: "%%" })).rows).toHaveLength(0);
      expect(await getPublicDoctor(ctx.db, U.d3)).toBeNull(); expect(await getPublicDoctor(ctx.db, U.d4)).toBeNull();
      expect((await getPublicDoctor(ctx.db, U.d1))?.consultationFeeBdt).toBe(700);
    });
  });
});
