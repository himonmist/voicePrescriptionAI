import { getDb } from "@/db/client";
import { aiUsage } from "@/db/schema";
import { makeDbRateLimiter } from "@/lib/security/rate-limit-db";
import { patientAccessFor } from "@/server/appointments/access";
import { drizzleConsultRepo } from "@/server/consultations/drizzle-repo";
import { drizzlePatientRepo } from "@/server/patients/drizzle-repo";
import { createDraftingService } from "./drafting";
import { providerFromEnv } from "./provider";

let svc: ReturnType<typeof createDraftingService> | undefined;
export const draftingService = () => {
  if (svc) return svc;
  const db = getDb(); const patients = drizzlePatientRepo(db);
  return (svc = createDraftingService(drizzleConsultRepo(db), {
    provider: providerFromEnv(), patientAccess: patientAccessFor(db), limiter: makeDbRateLimiter(db),
    async hasConsent(patientId, kind) { return (await patients.latestConsents(patientId)).find((c) => c.kind === kind)?.granted === true; },
    async recordUsage(u) { await db.insert(aiUsage).values(u); },
  }));
};
