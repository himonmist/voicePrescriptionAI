import { and, count, eq, like, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/types";
import { doctorProfiles, users } from "@/db/schema";

const PAGE = 20;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

const cols = {
  userId: doctorProfiles.userId, fullName: users.fullName, specialty: doctorProfiles.specialty, bio: doctorProfiles.bio,
  consultationFeeBdt: doctorProfiles.consultationFeeBdt, languages: doctorProfiles.languages, chamberAddress: doctorProfiles.chamberAddress,
  consultationMode: doctorProfiles.consultationMode, bmdcNumber: doctorProfiles.bmdcNumber,
};
/** Public listing: ACTIVE (verified) + opted-in doctors only, and only these fields — never email/phone. */
const visible = () => and(eq(doctorProfiles.status, "active"), eq(doctorProfiles.publicProfile, true), sql`${users.disabledAt} IS NULL`)!;

export async function listPublicDoctors(db: Db, o: { q?: string; specialty?: string; mode?: "in_person" | "online"; page?: number }) {
  const conds: SQL[] = [visible()];
  if (o.q?.trim()) { const t = "%" + escapeLike(o.q.trim().toLowerCase()) + "%"; conds.push(or(like(sql`lower(${users.fullName})`, t), like(sql`lower(${doctorProfiles.specialty})`, t))!); }
  if (o.specialty?.trim()) conds.push(sql`lower(${doctorProfiles.specialty}) = ${o.specialty.trim().toLowerCase()}`);
  if (o.mode) conds.push(or(eq(doctorProfiles.consultationMode, o.mode), eq(doctorProfiles.consultationMode, "both"))!);
  const where = and(...conds);
  const [rows, [t]] = await Promise.all([
    db.select(cols).from(doctorProfiles).innerJoin(users, eq(users.id, doctorProfiles.userId)).where(where).orderBy(users.fullName).limit(PAGE).offset((Math.max(1, o.page ?? 1) - 1) * PAGE),
    db.select({ n: count() }).from(doctorProfiles).innerJoin(users, eq(users.id, doctorProfiles.userId)).where(where),
  ]);
  return { rows, total: t.n };
}

export async function getPublicDoctor(db: Db, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [r] = await db.select(cols).from(doctorProfiles).innerJoin(users, eq(users.id, doctorProfiles.userId)).where(and(visible(), eq(doctorProfiles.userId, userId))).limit(1);
  return r ?? null;
}
