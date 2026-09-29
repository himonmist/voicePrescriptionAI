import { withActor } from "@/lib/api";
import { consultationService } from "@/server/consultations";

export const GET = withActor(async ({ actor, params }) => ({ versions: await consultationService().listVersions(actor, params.id) }));
