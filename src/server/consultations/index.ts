import { createConsultationService } from "./service";
import { drizzleConsultRepo } from "./drizzle-repo";
import { consultDepsFor } from "./deps";

let svc: ReturnType<typeof createConsultationService> | undefined;
export const consultationService = () => (svc ??= createConsultationService(drizzleConsultRepo(), consultDepsFor()));
