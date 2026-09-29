import { withActor } from "@/lib/api";
import { appointmentService } from "@/server/appointments";
import { addDays, utcToZoned } from "@/lib/time";

export const GET = withActor(async ({ req, actor }) => {
  const u = new URL(req.url); const today = utcToZoned(new Date()).date;
  return { appointments: await appointmentService().list(actor, u.searchParams.get("from") ?? today, u.searchParams.get("to") ?? addDays(today, 30)) };
});

/** POST — book. Body: { doctorUserId, startAt (ISO), mode, reason?, patientId? (staff/doctor), profile? {dob,sex} (first patient booking) } */
export const POST = withActor(({ actor, body }) => appointmentService().book(actor, body), { status: 201 });
