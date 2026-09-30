import { withActor } from "@/lib/api";
import { prescriptionService } from "@/server/prescriptions";

/** POST { reason } — reason of at least 10 characters is required and recorded. */
export const POST = withActor(({ actor, params, body }) => prescriptionService().amend(actor, params.id, { reason: (body as { reason?: unknown })?.reason }));
