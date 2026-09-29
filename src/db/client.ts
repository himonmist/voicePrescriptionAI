import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

if (typeof WebSocket === "undefined") neonConfig.webSocketConstructor = ws;

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example");
  const pool = new Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), pool };
}

let cached: ReturnType<typeof createDb> | undefined;
export function getDb() { return (cached ??= createDb()).db; }
export { schema };
