import { withActor } from "@/lib/api";
import { consultationService } from "@/server/consultations";

export const GET = withActor(({ actor, params }) => consultationService().getWorkspace(actor, params.id));
