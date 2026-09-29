import { describe, it, expect, beforeEach } from "vitest";
import { createAvailabilityService, type AvailabilityRepo, type RuleInput } from "@/server/appointments/availability";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import { ValidationError } from "@/server/errors";

const doc: Actor = { userId: "d1", roles: ["doctor"], orgId: null };
const r = (o: Partial<RuleInput> = {}): RuleInput => ({ weekday: 1, startTime: "09:00", endTime: "12:00", slotMinutes: 20, bufferMinutes: 0, mode: "both", location: "Chamber", maxPerDay: null, ...o });

function fake() {
  const st = { rules: [] as any[], ex: [] as any[], audit: [] as string[], profile: {} as any };
  const repo: AvailabilityRepo = {
    async replaceRules(_d, rules) { st.rules = rules; },
    async getRules() { return st.rules; },
    async addException(_d, e) { st.ex.push({ id: `e${st.ex.length + 1}`, ...e }); return `e${st.ex.length}`; },
    async removeException(_d, id) { const n = st.ex.length; st.ex = st.ex.filter((x) => x.id !== id); return st.ex.length < n; },
    async getExceptions() { return st.ex; },
    async updateProfile(_d, p) { st.profile = p; },
    async audit(e) { st.audit.push(e.action); },
  };
  return { repo, st };
}

describe("availability service", () => {
  let f: ReturnType<typeof fake>; let svc: ReturnType<typeof createAvailabilityService>;
  beforeEach(() => { f = fake(); svc = createAvailabilityService(f.repo); });

  it("only doctors manage schedules", async () => {
    for (const roles of [["patient"], ["receptionist"], ["super_admin"]] as const) await expect(svc.replaceSchedule({ userId: "x", roles: [...roles], orgId: null }, [r()])).rejects.toThrow(ForbiddenError);
  });
  it("saves a valid weekly schedule and audits", async () => {
    await svc.replaceSchedule(doc, [r(), r({ weekday: 1, startTime: "17:00", endTime: "20:00" }), r({ weekday: 3 })]);
    expect(f.st.rules).toHaveLength(3); expect(f.st.audit).toContain("availability.updated");
  });
  it("rejects invalid times, ordering, slot sizes and modes", async () => {
    for (const bad of [r({ startTime: "25:00" }), r({ endTime: "08:00" }), r({ slotMinutes: 2 }), r({ slotMinutes: 300 }), r({ bufferMinutes: -1 }), r({ weekday: 7 }), r({ mode: "telepathy" as any }), r({ maxPerDay: 0 }), r({ startTime: "09:00", endTime: "09:10", slotMinutes: 20 })])
      await expect(svc.replaceSchedule(doc, [bad])).rejects.toThrow(ValidationError);
  });
  it("rejects overlapping sessions on the same weekday but allows the same hours on different days", async () => {
    await expect(svc.replaceSchedule(doc, [r(), r({ startTime: "11:00", endTime: "13:00" })])).rejects.toThrow(/overlap/i);
    await svc.replaceSchedule(doc, [r(), r({ weekday: 2 })]);
  });
  it("limits sessions per day and total rows", async () => {
    await expect(svc.replaceSchedule(doc, Array.from({ length: 5 }, (_, i) => r({ startTime: `${8 + i * 2}:00`.padStart(5, "0"), endTime: `${9 + i * 2}:00`.padStart(5, "0") })))).rejects.toThrow(/at most/i);
  });
  it("empty schedule is allowed (doctor stops taking appointments)", async () => { await svc.replaceSchedule(doc, []); expect(f.st.rules).toEqual([]); });

  it("holiday/block exceptions validate dates and partial times", async () => {
    await svc.addException(doc, { date: "2026-12-16", kind: "holiday", reason: "Victory Day" });
    await svc.addException(doc, { date: "2026-12-17", kind: "block", startTime: "10:00", endTime: "11:00" });
    await expect(svc.addException(doc, { date: "2026-02-30", kind: "holiday" })).rejects.toThrow(ValidationError);
    await expect(svc.addException(doc, { date: "2026-12-17", kind: "block", startTime: "11:00", endTime: "10:00" })).rejects.toThrow(ValidationError);
    await expect(svc.addException(doc, { date: "2026-12-17", kind: "block", startTime: "10:00" })).rejects.toThrow(ValidationError);
    await expect(svc.addException(doc, { date: "2026-12-17", kind: "vacation" as any })).rejects.toThrow(ValidationError);
  });
  it("removing an unknown exception is a not-found, not a silent success", async () => {
    await expect(svc.removeException(doc, "nope")).rejects.toThrow(/not found/i);
  });

  describe("public profile", () => {
    it("validates fee, bio, mode, languages", async () => {
      await svc.updateProfile(doc, { consultationFeeBdt: 800, bio: "Cardiologist", languages: ["Bangla", "English"], chamberAddress: "Dhaka", consultationMode: "both", publicProfile: true });
      expect(f.st.profile.consultationFeeBdt).toBe(800);
      for (const bad of [{ consultationFeeBdt: -1 }, { consultationFeeBdt: 10_000_000 }, { consultationMode: "x" }, { languages: Array(20).fill("a") }, { bio: "x".repeat(2000) }])
        await expect(svc.updateProfile(doc, bad as any)).rejects.toThrow(ValidationError);
    });
    it("strips HTML from free text (stored as plain text)", async () => {
      await svc.updateProfile(doc, { bio: "Hello <script>alert(1)</script><b>world</b>" });
      expect(f.st.profile.bio).toBe("Hello alert(1)world");
    });
    it("non-doctors cannot edit doctor profiles", async () => { await expect(svc.updateProfile({ userId: "p", roles: ["patient"], orgId: null }, { bio: "x" })).rejects.toThrow(ForbiddenError); });
  });
});
