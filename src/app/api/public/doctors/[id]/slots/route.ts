import { publicHandler } from "@/lib/public-api";
import { appointmentService } from "@/server/appointments";
import { addDays, utcToZoned } from "@/lib/time";

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&mode=online|in_person — open slots only; no patient information. */
export const GET = publicHandler(async ({ req, params }) => {
  const u = new URL(req.url); const today = utcToZoned(new Date()).date;
  const mode = u.searchParams.get("mode");
  const slots = await appointmentService().availableSlots(params.id, u.searchParams.get("from") ?? today, u.searchParams.get("to") ?? addDays(today, 13), mode === "online" || mode === "in_person" ? mode : undefined);
  return { slots: slots.map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), date: s.date, time: s.startTime, mode: s.mode, location: s.location })) };
}, { cacheSeconds: 10 });
