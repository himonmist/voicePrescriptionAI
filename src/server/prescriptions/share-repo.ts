import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { auditEvents, patients, prescriptionShares, prescriptions } from "@/db/schema";
import { MAX_FAILED_ATTEMPTS, type ShareRepo, type ShareRow } from "./share";

const UUID = /^[0-9a-f-]{36}$/i;
const toRow = (r: typeof prescriptionShares.$inferSelect): ShareRow => ({ id: r.id, prescriptionId: r.prescriptionId, createdAt: r.createdAt, expiresAt: r.expiresAt, revokedAt: r.revokedAt, lockedAt: r.lockedAt, failedAttempts: r.failedAttempts, accessCount: r.accessCount, lastAccessedAt: r.lastAccessedAt });
const rxLite = (r: typeof prescriptions.$inferSelect) => ({ id: r.id, status: r.status, doctorUserId: r.doctorUserId, patientId: r.patientId, code: r.code, organizationId: r.organizationId });

export function drizzleShareRepo(db: Db = getDb()): ShareRepo {
  return {
    async prescription(id) {
      if (!UUID.test(id)) return null;
      const [r] = await db.select().from(prescriptions).where(eq(prescriptions.id, id)).limit(1);
      return r ? rxLite(r) : null;
    },
    async activeCount(id, now) {
      const [r] = await db.select({ n: count() }).from(prescriptionShares).where(and(eq(prescriptionShares.prescriptionId, id), isNull(prescriptionShares.revokedAt), isNull(prescriptionShares.lockedAt), gt(prescriptionShares.expiresAt, now)));
      return Number(r?.n ?? 0);
    },
    async create(i) {
      const [r] = await db.insert(prescriptionShares).values({ prescriptionId: i.prescriptionId, tokenHash: i.tokenHash, expiresAt: i.expiresAt, createdBy: i.createdBy }).returning({ id: prescriptionShares.id });
      return r.id;
    },
    async list(id) { return (await db.select().from(prescriptionShares).where(eq(prescriptionShares.prescriptionId, id)).orderBy(desc(prescriptionShares.createdAt))).map(toRow); },
    async revoke(id, shareId, by) {
      if (!UUID.test(shareId)) return false;
      const r = await db.update(prescriptionShares).set({ revokedAt: new Date(), revokedBy: by }).where(and(eq(prescriptionShares.id, shareId), eq(prescriptionShares.prescriptionId, id), isNull(prescriptionShares.revokedAt))).returning({ id: prescriptionShares.id });
      return r.length > 0;
    },
    async byTokenHash(hash) {
      const [r] = await db.select({ s: prescriptionShares, rx: prescriptions, dob: patients.dob }).from(prescriptionShares)
        .innerJoin(prescriptions, eq(prescriptions.id, prescriptionShares.prescriptionId)).innerJoin(patients, eq(patients.id, prescriptions.patientId))
        .where(eq(prescriptionShares.tokenHash, hash)).limit(1);
      return r ? { share: toRow(r.s), rx: rxLite(r.rx), patientDob: String(r.dob) } : null;
    },
    async recordFailure(shareId) {
      const [r] = await db.update(prescriptionShares).set({
        failedAttempts: sql`${prescriptionShares.failedAttempts} + 1`,
        lockedAt: sql`CASE WHEN ${prescriptionShares.failedAttempts} + 1 >= ${MAX_FAILED_ATTEMPTS} THEN COALESCE(${prescriptionShares.lockedAt}, now()) ELSE ${prescriptionShares.lockedAt} END`,
      }).where(eq(prescriptionShares.id, shareId)).returning({ n: prescriptionShares.failedAttempts });
      return r?.n ?? 0;
    },
    async recordAccess(shareId) { await db.update(prescriptionShares).set({ accessCount: sql`${prescriptionShares.accessCount} + 1`, lastAccessedAt: new Date() }).where(eq(prescriptionShares.id, shareId)); },
    async audit(e) { await db.insert(auditEvents).values({ action: e.action, actorId: e.actorId, organizationId: e.organizationId ?? null, resourceType: "prescription", resourceId: e.resourceId, metadata: e.metadata ?? {} }); },
  };
}
