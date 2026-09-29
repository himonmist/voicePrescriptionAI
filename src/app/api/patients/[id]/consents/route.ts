import { withActor } from "@/lib/api";
import { patientService } from "@/server/patients";

export const POST = withActor(({ actor, params, body }) => patientService().recordConsent(actor, params.id, body), { status: 201 });
