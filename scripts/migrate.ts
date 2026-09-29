import "dotenv/config";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { createDb } from "../src/db/client";

async function main() {
  const { db, pool } = createDb(process.env.MIGRATE_URL ?? process.env.DATABASE_URL);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
