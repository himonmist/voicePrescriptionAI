import { withActor } from "@/lib/api";
import { availabilityService } from "@/server/appointments";

export const PUT = withActor(async ({ actor, body }) => { await availabilityService().updateProfile(actor, (body ?? {}) as never); });
