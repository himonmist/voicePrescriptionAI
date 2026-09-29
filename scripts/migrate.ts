import "dotenv/config";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../src/db/client";

async function main() {
  const url = process.env.MIGRATE_URL ?? process.env.DATABASE_URL!;
  const { db, end } = createDb(url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (new URL(url).hostname.endsWith("neon.tech") ? migrate(db as any, { migrationsFolder: "./drizzle" }) : migratePg(db as any, { migrationsFolder: "./drizzle" }));
  console.log("migrations applied");
  await end();
}
main().catch((e) => { console.error(e); process.exit(1); });
