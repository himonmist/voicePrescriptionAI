import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { auditEvents, doctorProfiles, notifications } from "@/db/schema";
import type { DoctorStatus, VerificationRepo } from "./verification";

export function drizzleVerificationRepo(db: Db = getDb()): VerificationRepo {
  return {
    async getStatus(id) {
      const [r] = await db.select({ s: doctorProfiles.status }).from(doctorProfiles).where(eq(doctorProfiles.id, id)).limit(1);
      return (r?.s as DoctorStatus | undefined) ?? null;
    },
    async transition(i) {
      await db.transaction(async (tx) => {
        const updated = await tx.update(doctorProfiles)
          .set({ status: i.to, reviewNotes: i.notes ?? null, reviewedBy: i.actorId, reviewedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(doctorProfiles.id, i.doctorId), eq(doctorProfiles.status, i.from)))
          .returning({ userId: doctorProfiles.userId });
        if (updated.length === 0) throw new Error("Status changed concurrently; reload and retry");
        await tx.insert(auditEvents).values({ action: "doctor.status_changed", actorId: i.actorId, resourceType: "doctor_profile", resourceId: i.doctorId, metadata: { from: i.from, to: i.to } });
        if (i.notifyKind) await tx.insert(notifications).values({ userId: updated[0].userId, kind: i.notifyKind, payload: { status: i.to } });
      });
    },
  };
}
