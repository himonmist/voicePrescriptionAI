import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL;
export const hasDb = !!TEST_DB_URL;

/** Applies the real migrations to the throwaway test database (never DATABASE_URL). */
export async function setupTestDb() {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, pool };
}

export async function resetData(db: ReturnType<typeof drizzle<typeof schema>>) {
  // audit_events is immutable by trigger; disable only for test cleanup.
  await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update`);
  await db.execute(sql`TRUNCATE audit_events, notifications, doctor_credentials, doctor_profiles, sessions, user_roles, organization_memberships, organizations, users, rate_limits CASCADE`);
  await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update`);
}
