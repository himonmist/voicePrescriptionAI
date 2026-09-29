/** Bangladesh is UTC+6 with no DST, so a fixed offset is exact for Asia/Dhaka. All appointments are stored as UTC instants. */
export const DHAKA_OFFSET_MIN = 6 * 60;

export const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().startsWith(s);
export const isValidTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function zonedToUtc(date: string, time: string): Date {
  return new Date(Date.parse(`${date}T${time}:00Z`) - DHAKA_OFFSET_MIN * 60_000);
}

export function utcToZoned(d: Date): { date: string; time: string; weekday: number } {
  const z = new Date(d.getTime() + DHAKA_OFFSET_MIN * 60_000);
  return { date: z.toISOString().slice(0, 10), time: z.toISOString().slice(11, 16), weekday: z.getUTCDay() };
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
}

export const minutesBetween = (a: string, b: string) => { const [h1, m1] = a.split(":").map(Number), [h2, m2] = b.split(":").map(Number); return h2 * 60 + m2 - (h1 * 60 + m1); };
