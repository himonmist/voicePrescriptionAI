import { createPrescriptionService } from "./service";
import { drizzleRxRepo } from "./drizzle-repo";
import { rxDepsFor } from "./deps";

let svc: ReturnType<typeof createPrescriptionService> | undefined;
export const prescriptionService = () => (svc ??= createPrescriptionService(drizzleRxRepo(), rxDepsFor()));
