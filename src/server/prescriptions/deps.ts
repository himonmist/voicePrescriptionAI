import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/security/password";
import { makeDbRateLimiter } from "@/lib/security/rate-limit-db";
import { patientAccessFor } from "@/server/appointments/access";
import { createDrugService } from "@/server/drugs/service";
import { drizzleDrugRepo } from "@/server/drugs/drizzle-repo";
import type { RxDeps } from "./service";

export function rxDepsFor(db: Db = getDb()): RxDeps {
  const drugs = createDrugService(drizzleDrugRepo(db));
  return {
    patientAccess: patientAccessFor(db),
    drugs: { screeningData: (ids, names) => drugs.screeningData(ids, names) },
    limiter: makeDbRateLimiter(db),
    async checkPassword(userId, password) {
      const [u] = await db.select({ h: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
      return !!u && (await verifyPassword(password, u.h));
    },
  };
}
