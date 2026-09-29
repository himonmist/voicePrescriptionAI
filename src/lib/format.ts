import { utcToZoned } from "@/lib/time";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAYS = DAYS;
/** "Mon 5 Oct, 09:20" in Bangladesh time. */
export function fmtWhen(d: Date | string): string {
  const z = utcToZoned(new Date(d)); const [, m, day] = z.date.split("-");
  return `${DAYS[z.weekday]} ${Number(day)}/${Number(m)}, ${z.time}`;
}
export const fmtDay = (date: string) => { const [y, m, d] = date.split("-").map(Number); return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}/${m}`; };
