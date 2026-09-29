import { randomInt } from "node:crypto";
import { and, desc, eq, inArray, isNull, or, gt, like, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { auditEvents, doctorProfiles, patientClinicalItems, patientConsents, patientDoctorRelationships, patientMerges, patients } from "@/db/schema";
import { decryptField, encryptField } from "@/lib/security/crypto";
import { normalizeName, normalizePhone, phoneBlindIndex } from "@/lib/security/pii";
import { ConflictError } from "@/server/errors";
import type { PatientRecord, PatientRepo, Scope } from "./service";
import type { Relationship } from "./access";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => "SDA-" + Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
const enc = (v?: string | null) => (v ? encryptField(v) : null);
const dec = (v?: string | null) => (v ? decryptField(v) : null);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
const isUniqueViolation = (e: unknown) => { const c = (e as { code?: string; cause?: { code?: string } }); return c?.code === "23505" || c?.cause?.code === "23505"; };

export function drizzlePatientRepo(db: Db = getDb()): PatientRepo {
  const activeRel = (doctorUserId: string) => sql`EXISTS (SELECT 1 FROM ${patientDoctorRelationships} r WHERE r.patient_id = ${patients.id} AND r.doctor_user_id = ${doctorUserId} AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at > now()))`;
  const scopeWhere = (s: Scope): SQL => and(eq(patients.status, "active"), s.kind === "org" ? eq(patients.organizationId, s.orgId) : activeRel(s.doctorUserId))!;

  const toRecord = (p: typeof patients.$inferSelect): PatientRecord => ({
    id: p.id, organizationId: p.organizationId, patientCode: p.patientCode, fullName: p.fullName, dob: p.dob, sex: p.sex,
    phone: dec(p.phoneEnc), email: dec(p.emailEnc), address: dec(p.addressEnc),
    emergencyContact: p.emergencyContactEnc ? JSON.parse(decryptField(p.emergencyContactEnc)) : null,
    userId: p.userId, status: p.status as PatientRecord["status"],
  });

  return {
    async doctorStatus(userId) {
      const [r] = await db.select({ s: doctorProfiles.status }).from(doctorProfiles).where(eq(doctorProfiles.userId, userId)).limit(1);
      return r?.s ?? null;
    },
    async isDoctorInOrg(doctorUserId, orgId) {
      const [r] = await db.select({ id: doctorProfiles.id }).from(doctorProfiles).where(and(eq(doctorProfiles.userId, doctorUserId), eq(doctorProfiles.organizationId, orgId))).limit(1);
      return !!r;
    },
    async candidates(scope, probe) {
      const first = probe.fullNameNorm.split(" ")[0] ?? "";
      const conds: SQL[] = [eq(patients.dob, probe.dob)];
      if (probe.phoneIdx) conds.push(eq(patients.phoneIdx, probe.phoneIdx));
      if (first.length >= 3) conds.push(like(patients.fullNameNorm, escapeLike(first) + "%"));
      const rows = await db.select({ id: patients.id, code: patients.patientCode, name: patients.fullNameNorm, dob: patients.dob, phoneIdx: patients.phoneIdx }).from(patients).where(and(scopeWhere(scope), or(...conds))).limit(50);
      return rows.map((r) => ({ id: r.id, patientCode: r.code, fullNameNorm: r.name, dob: r.dob, phoneIdx: r.phoneIdx }));
    },
    async createPatient(i) {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await db.transaction(async (tx) => {
            const code = newCode();
            const [p] = await tx.insert(patients).values({
              organizationId: i.organizationId, patientCode: code, fullName: i.fullName, fullNameNorm: normalizeName(i.fullName), dob: i.dob, sex: i.sex,
              phoneEnc: enc(i.phone), phoneIdx: i.phone ? phoneBlindIndex(i.phone) : null, emailEnc: enc(i.email), addressEnc: enc(i.address),
              emergencyContactEnc: i.emergencyContact ? encryptField(JSON.stringify(i.emergencyContact)) : null, createdBy: i.createdBy,
            }).returning({ id: patients.id, code: patients.patientCode });
            if (i.treatingDoctorUserId) await tx.insert(patientDoctorRelationships).values({ patientId: p.id, doctorUserId: i.treatingDoctorUserId, kind: "treating", grantedBy: i.createdBy });
            return { id: p.id, patientCode: p.code };
          });
        } catch (e) { if (!(isUniqueViolation(e) && attempt < 3)) throw e; } // patient_code collision → retry
      }
      throw new Error("unreachable");
    },
    async getPatient(id) {
      const [p] = await db.select().from(patients).where(eq(patients.id, id)).limit(1);
      return p ? toRecord(p) : null;
    },
    async relationshipsFor(patientId): Promise<Relationship[]> {
      const rows = await db.select().from(patientDoctorRelationships).where(eq(patientDoctorRelationships.patientId, patientId));
      return rows.map((r) => ({ doctorUserId: r.doctorUserId, kind: r.kind as Relationship["kind"], expiresAt: r.expiresAt, revokedAt: r.revokedAt }));
    },
    async search(scope, q, limit, offset) {
      const phone = normalizePhone(q);
      const conds: SQL[] = [like(patients.fullNameNorm, "%" + escapeLike(normalizeName(q)) + "%"), eq(patients.patientCode, q.trim().toUpperCase())];
      if (phone) conds.push(eq(patients.phoneIdx, phoneBlindIndex(phone)));
      return db.select({ id: patients.id, patientCode: patients.patientCode, fullName: patients.fullName, dob: patients.dob, sex: patients.sex })
        .from(patients).where(and(scopeWhere(scope), or(...conds))).orderBy(patients.fullNameNorm).limit(Math.min(limit, 50)).offset(offset);
    },
    async addConsent(c) { await db.insert(patientConsents).values(c); },
    async latestConsents(patientId) {
      const rows = await db.select().from(patientConsents).where(eq(patientConsents.patientId, patientId)).orderBy(desc(patientConsents.createdAt), desc(patientConsents.id));
      const seen = new Set<string>(); const out = [];
      for (const r of rows) if (!seen.has(r.kind)) { seen.add(r.kind); out.push({ kind: r.kind, granted: r.granted, method: r.method, policyVersion: r.policyVersion, createdAt: r.createdAt }); }
      return out;
    },
    async addClinicalItem(i) {
      const [r] = await db.insert(patientClinicalItems).values({ patientId: i.patientId, kind: i.kind, descriptionEnc: encryptField(i.description), severity: i.severity, recordedBy: i.recordedBy }).returning({ id: patientClinicalItems.id });
      return r.id;
    },
    async listClinicalItems(patientId) {
      const rows = await db.select().from(patientClinicalItems).where(eq(patientClinicalItems.patientId, patientId)).orderBy(desc(patientClinicalItems.createdAt));
      return rows.map((r) => ({ id: r.id, kind: r.kind, description: decryptField(r.descriptionEnc), severity: r.severity, status: r.status, createdAt: r.createdAt }));
    },
    async setClinicalItemStatus(patientId, itemId, status, reason) {
      const r = await db.update(patientClinicalItems).set({ status, statusReason: reason, updatedAt: new Date() }).where(and(eq(patientClinicalItems.id, itemId), eq(patientClinicalItems.patientId, patientId))).returning({ id: patientClinicalItems.id });
      return r.length > 0;
    },
    async grantAccess(g) {
      try { await db.insert(patientDoctorRelationships).values({ patientId: g.patientId, doctorUserId: g.doctorUserId, kind: "shared", reason: g.reason, grantedBy: g.grantedBy, expiresAt: g.expiresAt }); }
      catch (e) { if (isUniqueViolation(e)) throw new ConflictError("This doctor already has access"); throw e; }
    },
    async revokeAccess(patientId, doctorUserId, revokedBy) {
      const r = await db.update(patientDoctorRelationships).set({ revokedAt: new Date(), revokedBy })
        .where(and(eq(patientDoctorRelationships.patientId, patientId), eq(patientDoctorRelationships.doctorUserId, doctorUserId), isNull(patientDoctorRelationships.revokedAt))).returning({ id: patientDoctorRelationships.id });
      return r.length > 0;
    },
    async merge(m) {
      await db.transaction(async (tx) => {
        const src = await tx.update(patients).set({ status: "merged", mergedIntoId: m.targetId, updatedAt: new Date() }).where(and(eq(patients.id, m.sourceId), eq(patients.status, "active"))).returning({ id: patients.id });
        if (src.length === 0) throw new Error("Source patient is no longer active");
        await tx.update(patientClinicalItems).set({ patientId: m.targetId }).where(eq(patientClinicalItems.patientId, m.sourceId));
        await tx.update(patientConsents).set({ patientId: m.targetId }).where(eq(patientConsents.patientId, m.sourceId));
        await tx.execute(sql`INSERT INTO patient_doctor_relationships (patient_id, doctor_user_id, kind, reason, granted_by, expires_at)
          SELECT ${m.targetId}, s.doctor_user_id, s.kind, 'carried over from merge', ${m.mergedBy}, s.expires_at FROM patient_doctor_relationships s
          WHERE s.patient_id = ${m.sourceId} AND s.revoked_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM patient_doctor_relationships t WHERE t.patient_id = ${m.targetId} AND t.doctor_user_id = s.doctor_user_id AND t.revoked_at IS NULL)`);
        await tx.update(patientDoctorRelationships).set({ revokedAt: new Date(), revokedBy: m.mergedBy }).where(and(eq(patientDoctorRelationships.patientId, m.sourceId), isNull(patientDoctorRelationships.revokedAt)));
        await tx.insert(patientMerges).values({ sourceId: m.sourceId, targetId: m.targetId, mergedBy: m.mergedBy, reason: m.reason });
      });
    },
    async audit(e) {
      await db.insert(auditEvents).values({ action: e.action, actorId: e.actorId, organizationId: e.organizationId ?? null, resourceType: e.resourceType, resourceId: e.resourceId, metadata: e.metadata ?? {} });
    },
  };
}
