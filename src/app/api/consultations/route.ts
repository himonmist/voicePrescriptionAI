import { withActor } from "@/lib/api";
import { consultationService } from "@/server/consultations";

/** POST { appointmentId } | { patientId } (walk-in). Idempotent: repeating returns the same consultation with created:false. */
export const POST = withActor(({ actor, body }) => consultationService().start(actor, body));
