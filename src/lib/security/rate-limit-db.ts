import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { rateLimits } from "@/db/schema";
import type { RateResult } from "./rate-limit";

/** Cross-instance fixed-window limiter using one atomic upsert per hit. */
export const makeDbRateLimiter = (db: Db) => ({
  async hit(key: string, limit: number, windowMs: number): Promise<RateResult> {
    const [r] = await db.insert(rateLimits).values({ key, count: 1, windowStart: new Date() }).onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStart} < now() - (${windowMs} || ' milliseconds')::interval THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${rateLimits.windowStart} < now() - (${windowMs} || ' milliseconds')::interval THEN now() ELSE ${rateLimits.windowStart} END`,
      },
    }).returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });
    const allowed = r.count <= limit;
    return { allowed, remaining: Math.max(0, limit - r.count), retryAfterMs: allowed ? 0 : Math.max(0, r.windowStart.getTime() + windowMs - Date.now()) };
  },
});

export const dbRateLimiter = {
  hit: (key: string, limit: number, windowMs: number) => makeDbRateLimiter(getDb()).hit(key, limit, windowMs),
};
