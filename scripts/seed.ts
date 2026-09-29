import "dotenv/config";
import { createDb } from "../src/db/client";
import { drizzleAuthRepo } from "../src/server/auth/drizzle-repo";
import { hashPassword, validatePasswordPolicy } from "../src/lib/security/password";

/** Creates the first super admin. Credentials come from env — never committed. Marked as a real account (not test). */
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase(); const pw = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !pw) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD");
  const pol = validatePasswordPolicy(pw); if (!pol.ok) throw new Error(pol.reason);
  const { db, end } = createDb();
  const repo = drizzleAuthRepo(db);
  if (await repo.findUserByEmail(email)) { console.log("admin already exists"); return end(); }
  const u = await repo.createUser({ email, fullName: "Platform Admin", phone: "01700000000", passwordHash: await hashPassword(pw), roles: ["super_admin"] });
  await repo.audit({ action: "admin.seeded", actorId: u.id });
  console.log("super admin created:", email);
  await end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
