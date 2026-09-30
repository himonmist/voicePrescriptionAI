import { withActor } from "@/lib/api";
import { prescriptionService } from "@/server/prescriptions";

/** POST — start (or return the existing) prescription draft for this consultation. Pre-filled from the note; no drugs are suggested. */
export const POST = withActor(({ actor, params }) => prescriptionService().createDraft(actor, params.id));
