import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as PgPool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import ws from "ws";
import * as schema from "./schema";
import type { Db } from "./types";

if (typeof WebSocket === "undefined") neonConfig.webSocketConstructor = ws;

/** Neon hosts use the serverless (WebSocket) driver; anything else (local dev / CI) uses plain node-postgres. */
export function createDb(url = process.env.DATABASE_URL): { db: Db; end: () => Promise<void> } {
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example");
  if (new URL(url).hostname.endsWith("neon.tech")) {
    const pool = new NeonPool({ connectionString: url });
    return { db: drizzleNeon(pool, { schema }), end: () => pool.end() };
  }
  const pool = new PgPool({ connectionString: url });
  return { db: drizzlePg(pool, { schema }), end: () => pool.end() };
}

let cached: ReturnType<typeof createDb> | undefined;
export function getDb(): Db { return (cached ??= createDb()).db; }
export { schema };
