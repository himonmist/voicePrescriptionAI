import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { auditEvents, availabilityExceptions, availabilitySchedules, doctorProfiles } from "@/db/schema";
import type { AvailabilityRepo } from "./availability";

export function drizzleAvailabilityRepo(db: Db = getDb()): AvailabilityRepo {
  return {
    async replaceRules(doctorUserId, rules) {
      await db.transaction(async (tx) => {
        await tx.delete(availabilitySchedules).where(eq(availabilitySchedules.doctorUserId, doctorUserId));
        if (rules.length) await tx.insert(availabilitySchedules).values(rules.map((r) => ({ ...r, doctorUserId })));
      });
    },
    async getRules(id) { return db.select().from(availabilitySchedules).where(eq(availabilitySchedules.doctorUserId, id)).orderBy(asc(availabilitySchedules.weekday), asc(availabilitySchedules.startTime)); },
    async addException(doctorUserId, e) {
      const [r] = await db.insert(availabilityExceptions).values({ doctorUserId, date: e.date, kind: e.kind, startTime: e.startTime ?? null, endTime: e.endTime ?? null, reason: e.reason ?? null }).returning({ id: availabilityExceptions.id });
      return r.id;
    },
    async removeException(doctorUserId, id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
      const r = await db.delete(availabilityExceptions).where(and(eq(availabilityExceptions.id, id), eq(availabilityExceptions.doctorUserId, doctorUserId))).returning({ id: availabilityExceptions.id });
      return r.length > 0;
    },
    async getExceptions(id) { return db.select().from(availabilityExceptions).where(eq(availabilityExceptions.doctorUserId, id)).orderBy(asc(availabilityExceptions.date)); },
    async updateProfile(userId, p) { await db.update(doctorProfiles).set({ ...p, updatedAt: new Date() }).where(eq(doctorProfiles.userId, userId)); },
    async audit(e) { await db.insert(auditEvents).values({ action: e.action, actorId: e.actorId, resourceType: "doctor", resourceId: e.actorId }); },
  };
}
