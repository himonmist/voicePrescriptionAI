import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { dbRateLimiter } from "@/lib/security/rate-limit-db";
import { drizzleMfaRepo } from "./drizzle-repo";
import { createMfaService } from "./service";

let svc: ReturnType<typeof createMfaService> | undefined;
export const mfaService = () => (svc ??= createMfaService(drizzleMfaRepo(), dbRateLimiter));
export async function accountLabel(userId: string) {
  const [u] = await getDb().select({ e: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.e ?? userId;
}
