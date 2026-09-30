import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { createDrugService } from "../src/server/drugs/service";
import { drizzleDrugRepo } from "../src/server/drugs/drizzle-repo";

/**
 * Operator tool: import an AUTHORIZED drug reference file.
 *   npm run drugs:import -- path/to/file.json admin@example.com
 * The file must contain source{name,version,publishedAt,licenceNote}, drugs[], interactions[]. Runs through the same
 * validation and audit as the admin API. Never commit real reference data to this repository.
 */
async function main() {
  const [file, email] = process.argv.slice(2);
  if (!file || !email) throw new Error("usage: npm run drugs:import -- <file.json> <super-admin-email>");
  const { db, end } = createDb();
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (!u) throw new Error(`No user with email ${email}`);
  const r = await createDrugService(drizzleDrugRepo(db)).importReference({ userId: u.id, roles: ["super_admin"], orgId: null }, JSON.parse(readFileSync(file, "utf8")));
  console.log(`imported ${r.drugCount} drugs, ${r.interactionCount} interactions`);
  await end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
