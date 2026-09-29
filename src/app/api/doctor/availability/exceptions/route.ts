import { withActor } from "@/lib/api";
import { availabilityService } from "@/server/appointments";

export const POST = withActor(({ actor, body }) => availabilityService().addException(actor, body as never), { status: 201 });
