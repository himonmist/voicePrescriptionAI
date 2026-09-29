import { count, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/types";
import { doctorProfiles, users } from "@/db/schema";

const MAX_PAGE = 100;

/** Admin review list. Deliberately selects only operational fields — no password hash, no clinical data. */
export async function listDoctorsForReview(db: Db, o: { statuses: string[]; limit: number; offset: number }) {
  const limit = Math.min(Math.max(1, o.limit), MAX_PAGE);
  const where = inArray(doctorProfiles.status, o.statuses as never[]);
  const [rows, [t]] = await Promise.all([
    db.select({ id: doctorProfiles.id, fullName: users.fullName, email: users.email, bmdcNumber: doctorProfiles.bmdcNumber, specialty: doctorProfiles.specialty, status: doctorProfiles.status, createdAt: doctorProfiles.createdAt, isTestAccount: users.isTestAccount })
      .from(doctorProfiles).innerJoin(users, eq(users.id, doctorProfiles.userId)).where(where).orderBy(desc(doctorProfiles.createdAt)).limit(limit).offset(Math.max(0, o.offset)),
    db.select({ n: count() }).from(doctorProfiles).where(where),
  ]);
  return { rows, total: t.n };
}

export async function getDoctorByUserId(db: Db, userId: string) {
  const [r] = await db.select().from(doctorProfiles).where(eq(doctorProfiles.userId, userId)).limit(1);
  return r ?? null;
}
