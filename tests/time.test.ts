import { describe, it, expect } from "vitest";
import { zonedToUtc, utcToZoned, addDays, isValidDate, isValidTime } from "@/lib/time";

describe("Asia/Dhaka time helpers (UTC+6, no DST)", () => {
  it("converts local date+time to UTC", () => {
    expect(zonedToUtc("2026-10-05", "09:30").toISOString()).toBe("2026-10-05T03:30:00.000Z");
    expect(zonedToUtc("2026-10-05", "00:15").toISOString()).toBe("2026-10-04T18:15:00.000Z"); // crosses UTC day
  });
  it("converts UTC back to local date/time/weekday", () => {
    expect(utcToZoned(new Date("2026-10-04T18:15:00Z"))).toEqual({ date: "2026-10-05", time: "00:15", weekday: 1 }); // Mon
    expect(utcToZoned(new Date("2026-10-09T17:59:00Z"))).toEqual({ date: "2026-10-09", time: "23:59", weekday: 5 }); // Fri
  });
  it("round-trips", () => {
    const d = zonedToUtc("2027-02-28", "23:45"); const z = utcToZoned(d);
    expect(zonedToUtc(z.date, z.time).getTime()).toBe(d.getTime());
  });
  it("adds days across month/year boundaries", () => { expect(addDays("2026-12-31", 1)).toBe("2027-01-01"); expect(addDays("2026-03-01", -1)).toBe("2026-02-28"); });
  it("validates dates and times strictly", () => {
    expect(isValidDate("2026-02-29")).toBe(false); expect(isValidDate("2028-02-29")).toBe(true); expect(isValidDate("26-1-1")).toBe(false);
    expect(isValidTime("24:00")).toBe(false); expect(isValidTime("09:05")).toBe(true); expect(isValidTime("9:5")).toBe(false);
  });
});
