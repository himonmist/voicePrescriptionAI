import { describe, it, expect } from "vitest";
import { generateSlots, type Rule, type Exception } from "@/server/appointments/slots";
import { zonedToUtc } from "@/lib/time";

// 2026-10-05 is a Monday (weekday 1)
const MON = "2026-10-05";
const rule = (o: Partial<Rule> = {}): Rule => ({ weekday: 1, startTime: "09:00", endTime: "11:00", slotMinutes: 20, bufferMinutes: 0, mode: "both", location: "Chamber A", maxPerDay: null, validFrom: null, validTo: null, ...o });
const now = zonedToUtc("2026-10-01", "08:00");
const gen = (o: Partial<Parameters<typeof generateSlots>[0]> = {}) => generateSlots({ rules: [rule()], exceptions: [], busy: [], fromDate: MON, toDate: MON, now, ...o });
const times = (s: ReturnType<typeof gen>) => s.map((x) => x.startTime);

describe("slot generation", () => {
  it("builds a 20-minute grid inside the working window", () => {
    expect(times(gen())).toEqual(["09:00", "09:20", "09:40", "10:00", "10:20", "10:40"]);
  });
  it("returns UTC instants (Dhaka local → UTC)", () => { expect(gen()[0].startAt.toISOString()).toBe("2026-10-05T03:00:00.000Z"); expect(gen()[0].endAt.toISOString()).toBe("2026-10-05T03:20:00.000Z"); });
  it("buffer spaces slots without changing slot length", () => {
    const s = gen({ rules: [rule({ bufferMinutes: 10 })] });
    expect(times(s)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    expect(s[0].endAt.getTime() - s[0].startAt.getTime()).toBe(20 * 60_000);
  });
  it("only generates on the rule's weekday", () => { expect(gen({ fromDate: "2026-10-06", toDate: "2026-10-06" })).toEqual([]); });
  it("a slot that would overrun the window end is dropped", () => { expect(times(gen({ rules: [rule({ endTime: "09:50" })] }))).toEqual(["09:00", "09:20"]); });
  it("removes slots overlapping existing active appointments", () => {
    const busy = [{ startAt: zonedToUtc(MON, "09:20"), endAt: zonedToUtc(MON, "09:40") }];
    expect(times(gen({ busy }))).toEqual(["09:00", "09:40", "10:00", "10:20", "10:40"]);
  });
  it("a longer busy block removes every slot it touches", () => {
    const busy = [{ startAt: zonedToUtc(MON, "09:10"), endAt: zonedToUtc(MON, "10:05") }];
    expect(times(gen({ busy }))).toEqual(["10:20", "10:40"]);
  });
  it("holiday removes the whole day", () => {
    const ex: Exception[] = [{ date: MON, kind: "holiday", startTime: null, endTime: null }];
    expect(gen({ exceptions: ex })).toEqual([]);
  });
  it("a partial-day block (break) removes only overlapping slots", () => {
    const ex: Exception[] = [{ date: MON, kind: "block", startTime: "10:00", endTime: "10:30" }];
    expect(times(gen({ exceptions: ex }))).toEqual(["09:00", "09:20", "09:40", "10:40"]);
  });
  it("respects minimum lead time and never returns past slots", () => {
    const n = zonedToUtc(MON, "09:10");
    expect(times(gen({ now: n, minLeadMinutes: 30 }))).toEqual(["09:40", "10:00", "10:20", "10:40"]); // exactly 30 min ahead is allowed
    expect(times(gen({ now: n, minLeadMinutes: 31 }))).toEqual(["10:00", "10:20", "10:40"]);
    expect(gen({ now: zonedToUtc(MON, "12:00") })).toEqual([]);
  });
  it("enforces the maximum advance booking window", () => {
    expect(gen({ now: zonedToUtc("2026-07-01", "08:00"), maxAdvanceDays: 30 })).toEqual([]);
    expect(gen({ now: zonedToUtc("2026-09-20", "08:00"), maxAdvanceDays: 30 })).not.toEqual([]);
  });
  it("daily cap counts already-booked appointments that day", () => {
    const busy = [{ startAt: zonedToUtc(MON, "09:00"), endAt: zonedToUtc(MON, "09:20") }, { startAt: zonedToUtc(MON, "09:20"), endAt: zonedToUtc(MON, "09:40") }];
    expect(times(gen({ rules: [rule({ maxPerDay: 3 })], busy }))).toEqual(["09:40"]);
    expect(gen({ rules: [rule({ maxPerDay: 2 })], busy })).toEqual([]);
  });
  it("respects rule validity dates", () => {
    expect(gen({ rules: [rule({ validFrom: "2026-10-06" })] })).toEqual([]);
    expect(gen({ rules: [rule({ validTo: "2026-10-04" })] })).toEqual([]);
    expect(gen({ rules: [rule({ validFrom: "2026-10-05", validTo: "2026-10-05" })] })).not.toEqual([]);
  });
  it("filters by consultation mode (both matches either)", () => {
    const rules = [rule({ startTime: "09:00", endTime: "09:20", mode: "online" }), rule({ startTime: "10:00", endTime: "10:20", mode: "in_person" }), rule({ startTime: "11:00", endTime: "11:20", mode: "both" })];
    expect(times(gen({ rules, mode: "online" }))).toEqual(["09:00", "11:00"]);
    expect(times(gen({ rules, mode: "in_person" }))).toEqual(["10:00", "11:00"]);
  });
  it("multiple sessions per day (morning + evening) merge in time order", () => {
    const rules = [rule({ startTime: "17:00", endTime: "17:40" }), rule({ startTime: "09:00", endTime: "09:40" })];
    expect(times(gen({ rules }))).toEqual(["09:00", "09:20", "17:00", "17:20"]);
  });
  it("spans multiple days and orders chronologically", () => {
    const s = gen({ fromDate: "2026-10-05", toDate: "2026-10-12" });
    expect(s.some((x) => x.date === "2026-10-12")).toBe(true);
    expect(s.map((x) => x.startAt.getTime())).toEqual([...s.map((x) => x.startAt.getTime())].sort((a, b) => a - b));
  });
  it("caps the range length so one call cannot enumerate years", () => { expect(() => gen({ fromDate: "2026-10-01", toDate: "2027-12-31" })).toThrow(/range/i); });
});
