import { withActor } from "@/lib/api";
import { availabilityService } from "@/server/appointments";

export const DELETE = withActor(async ({ actor, params }) => { await availabilityService().removeException(actor, params.id); });
