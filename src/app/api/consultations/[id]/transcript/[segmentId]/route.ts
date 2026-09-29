import { withActor } from "@/lib/api";
import { consultationService } from "@/server/consultations";

/** PATCH { text?, flagged?, speaker? } — edits keep the first original text for traceability. */
export const PATCH = withActor(({ actor, params, body }) => consultationService().updateSegment(actor, params.id, params.segmentId, body));
