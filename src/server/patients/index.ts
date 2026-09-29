import { createPatientService } from "./service";
import { drizzlePatientRepo } from "./drizzle-repo";

let svc: ReturnType<typeof createPatientService> | undefined;
export const patientService = () => (svc ??= createPatientService(drizzlePatientRepo()));
