import { withActor } from "@/lib/api";
import { prescriptionService } from "@/server/prescriptions";

export const POST = withActor(async ({ actor, params }) => { await prescriptionService().approve(actor, params.id); });
