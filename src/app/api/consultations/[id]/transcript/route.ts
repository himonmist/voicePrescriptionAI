import { withActor } from "@/lib/api";
import { consultationService } from "@/server/consultations";

export const POST = withActor(({ actor, params, body }) => consultationService().addSegment(actor, params.id, body), { status: 201 });
