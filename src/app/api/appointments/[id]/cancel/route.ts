import { withActor } from "@/lib/api";
import { appointmentService } from "@/server/appointments";

export const POST = withActor(async ({ actor, params, body }) => {
  await appointmentService().cancel(actor, params.id, typeof (body as { reason?: unknown })?.reason === "string" ? (body as { reason: string }).reason : undefined);
});
