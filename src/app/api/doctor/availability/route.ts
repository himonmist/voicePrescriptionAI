import { withActor } from "@/lib/api";
import { availabilityService } from "@/server/appointments";
import { ValidationError } from "@/server/errors";

export const GET = withActor(({ actor }) => availabilityService().getSchedule(actor));
export const PUT = withActor(async ({ actor, body }) => {
  const rules = (body as { rules?: unknown })?.rules;
  if (!Array.isArray(rules)) throw new ValidationError("rules must be an array");
  await availabilityService().replaceSchedule(actor, rules);
});
