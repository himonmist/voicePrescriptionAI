import { withActor } from "@/lib/api";
import { patientService } from "@/server/patients";

export const GET = withActor(({ actor, params }) => patientService().getPatient(actor, params.id));
