import "dotenv/config";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { hashPassword } from "../src/lib/security/password";

/**
 * Creates TEST-ONLY demo accounts (flagged is_test_account) for trying the web app and admin console.
 * - Passwords are random and printed once here; nothing is committed. Override with DEMO_PASSWORD (must meet the policy).
 * - `--sql` prints the statements instead of running them (use when the database is not reachable from this machine).
 * - Re-running never changes an existing account's password.
 * - Refuses non-local databases unless ALLOW_DEMO_SEED=yes. Delete the demo accounts before real users are onboarded.
 */
const DOMAIN = "demo.smartdoctoraid.test";
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
// Unambiguous alphabet (no l/I/1/O/0) so passwords survive being read off a screen and retyped.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genPassword = () => `Demo-${Array.from(randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join("")}-9!`;

async function main() {
  const printOnly = process.argv.includes("--sql");
  const url = process.env.DATABASE_URL ?? "";
  if (!printOnly) {
    if (!url) throw new Error("DATABASE_URL is required (or use --sql)");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    if (!local && process.env.ALLOW_DEMO_SEED !== "yes") throw new Error("Refusing to seed demo accounts into a non-local database. Set ALLOW_DEMO_SEED=yes if you really mean it.");
  }
  const accounts = [
    { key: "admin", role: "super_admin", name: "Demo Admin", phone: "01700000001" },
    { key: "doctor", role: "doctor", name: "Dr. Demo Doctor", phone: "01700000002" },
    { key: "patient", role: "patient", name: "Demo Patient", phone: "01700000003" },
  ] as const;
  const stmts: string[] = []; const creds: { email: string; password: string; role: string }[] = [];
  for (const a of accounts) {
    const email = `${a.key}@${DOMAIN}`; const password = process.env.DEMO_PASSWORD ?? genPassword(); const hash = await hashPassword(password);
    creds.push({ email, password, role: a.role });
    stmts.push(`INSERT INTO users (email, phone, full_name, password_hash, is_test_account, email_verified_at) VALUES (${q(email)}, ${q(a.phone)}, ${q(a.name)}, ${q(hash)}, true, now()) ON CONFLICT (email) DO NOTHING`);
    stmts.push(`INSERT INTO user_roles (user_id, role) SELECT id, ${q(a.role)} FROM users WHERE email = ${q(email)} AND is_test_account ON CONFLICT DO NOTHING`);
  }
  stmts.push(`INSERT INTO doctor_profiles (user_id, bmdc_number, specialty, status, public_profile, consultation_fee_bdt, bio, languages, chamber_address, consultation_mode) SELECT id, 'DEMO-0001', 'General Practice', 'active', true, 500, 'Demo doctor account for testing. Not a real practitioner.', '["Bangla","English"]'::jsonb, 'Demo Chamber, Dhaka', 'both' FROM users WHERE email = ${q(`doctor@${DOMAIN}`)} AND is_test_account ON CONFLICT DO NOTHING`);

  if (printOnly) console.log(stmts.join(";\n") + ";\n");
  else {
    const { createDb } = await import("../src/db/client"); const { db, end } = createDb();
    const existing = new Set((await db.execute(sql`SELECT email FROM users WHERE email LIKE ${"%@" + DOMAIN}`)).rows.map((r: unknown) => String((r as { email: string }).email)));
    for (const s of stmts) await db.execute(sql.raw(s));
    await end();
    for (let i = creds.length - 1; i >= 0; i--) if (existing.has(creds[i].email)) creds[i].password = "(already existed — password unchanged)";
  }
  console.error("\nDEMO ACCOUNTS (test only). If an account already existed its password was NOT changed.");
  for (const c of creds) console.error(`  ${c.role.padEnd(11)} ${c.email}  ${c.password}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
