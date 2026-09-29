import { withActor } from "@/lib/api";
import { patientService } from "@/server/patients";

export const POST = withActor(async ({ actor, params, body }) => ({ id: await patientService().addClinicalItem(actor, params.id, body) }), { status: 201 });
