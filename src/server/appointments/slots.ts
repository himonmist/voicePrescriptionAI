import { addDays, utcToZoned, zonedToUtc } from "@/lib/time";

export type Mode = "in_person" | "online" | "both";
export interface Rule { weekday: number; startTime: string; endTime: string; slotMinutes: number; bufferMinutes: number; mode: Mode; location: string | null; maxPerDay: number | null; validFrom: string | null; validTo: string | null }
export interface Exception { date: string; kind: "holiday" | "block"; startTime: string | null; endTime: string | null }
export interface Busy { startAt: Date; endAt: Date }
export interface Slot { startAt: Date; endAt: Date; date: string; startTime: string; mode: Mode; location: string | null }

const MAX_RANGE_DAYS = 62;
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

/**
 * Pure availability engine. The booking service re-runs this on the server and only accepts a
 * start time that this function offers, so clients cannot invent slots. The DB exclusion
 * constraint is the final guard against races.
 */
export function generateSlots(o: { rules: Rule[]; exceptions: Exception[]; busy: Busy[]; fromDate: string; toDate: string; now: Date; minLeadMinutes?: number; maxAdvanceDays?: number; mode?: "in_person" | "online" }): Slot[] {
  const lead = o.minLeadMinutes ?? 60, advance = o.maxAdvanceDays ?? 60;
  const days = (Date.parse(o.toDate) - Date.parse(o.fromDate)) / 86_400_000 + 1;
  if (!(days >= 1) || days > MAX_RANGE_DAYS) throw new Error(`Date range must be 1–${MAX_RANGE_DAYS} days`);
  const earliest = o.now.getTime() + lead * 60_000, latest = o.now.getTime() + advance * 86_400_000;
  const busy = o.busy.map((b) => [b.startAt.getTime(), b.endAt.getTime()] as const);
  const out: Slot[] = [];

  for (let date = o.fromDate; date <= o.toDate; date = addDays(date, 1)) {
    const weekday = utcToZoned(zonedToUtc(date, "00:00")).weekday;
    const dayEx = o.exceptions.filter((e) => e.date === date);
    if (dayEx.some((e) => e.kind === "holiday" || (e.startTime === null && e.endTime === null))) continue;
    const blocks = dayEx.filter((e) => e.startTime && e.endTime).map((e) => [zonedToUtc(date, e.startTime!).getTime(), zonedToUtc(date, e.endTime!).getTime()] as const);

    for (const r of o.rules) {
      if (r.weekday !== weekday || (r.validFrom && date < r.validFrom) || (r.validTo && date > r.validTo)) continue;
      if (o.mode && r.mode !== "both" && r.mode !== o.mode) continue;
      const w0 = zonedToUtc(date, r.startTime).getTime(), w1 = zonedToUtc(date, r.endTime).getTime();
      const slotMs = r.slotMinutes * 60_000, stepMs = (r.slotMinutes + r.bufferMinutes) * 60_000;
      let remaining = r.maxPerDay === null ? Infinity : r.maxPerDay - busy.filter(([s]) => s >= w0 && s < w1).length;
      for (let t = w0; t + slotMs <= w1 && remaining > 0; t += stepMs) {
        const e = t + slotMs;
        if (t < earliest || t > latest) continue;
        if (busy.some(([b0, b1]) => overlaps(t, e, b0, b1)) || blocks.some(([b0, b1]) => overlaps(t, e, b0, b1))) continue;
        out.push({ startAt: new Date(t), endAt: new Date(e), date, startTime: utcToZoned(new Date(t)).time, mode: r.mode, location: r.location });
        remaining--;
      }
    }
  }
  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
