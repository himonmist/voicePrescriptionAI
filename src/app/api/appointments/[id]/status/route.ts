import { z } from "zod";
import { withActor } from "@/lib/api";
import { appointmentService } from "@/server/appointments";
import { ValidationError } from "@/server/errors";

export const POST = withActor(async ({ actor, params, body }) => {
  const p = z.object({ to: z.enum(["checked_in", "in_progress", "completed", "no_show"]) }).safeParse(body);
  if (!p.success) throw new ValidationError("Invalid status");
  await appointmentService().transition(actor, params.id, p.data.to);
});
