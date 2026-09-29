import { withActor } from "@/lib/api";
import { appointmentService } from "@/server/appointments";

export const POST = withActor(async ({ actor, params, body }) => { await appointmentService().reschedule(actor, params.id, body); });
