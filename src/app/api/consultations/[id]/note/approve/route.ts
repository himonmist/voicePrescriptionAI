import { withActor } from "@/lib/api";
import { consultationService } from "@/server/consultations";

export const POST = withActor(async ({ actor, params }) => { await consultationService().approveNote(actor, params.id); });
