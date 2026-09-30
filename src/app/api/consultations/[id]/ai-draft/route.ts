import { withActor } from "@/lib/api";
import { draftingService } from "@/server/ai";

/** POST — draft note sections from the transcript (doctor-only, consent-gated). Never approves anything. */
export const POST = withActor(({ actor, params }) => draftingService().draftNote(actor, params.id));
