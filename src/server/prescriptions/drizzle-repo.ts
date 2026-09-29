import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { auditEvents, consultations, doctorProfiles, prescriptionVersions, prescriptions, users } from "@/db/schema";
import { decryptField, encryptField } from "@/lib/security/crypto";
import { ConflictError } from "@/server/errors";
import { newPatientCode } from "@/server/patients/code";
import { drizzleConsultRepo } from "@/server/consultations/drizzle-repo";
import { drizzlePatientRepo } from "@/server/patients/drizzle-repo";
import type { PrescriptionContent } from "./content";
import type { Rx, RxRepo } from "./service";

const UUID = /^[0-9a-f-]{36}$/i;
const newRxCode = () => "RX-" + newPatientCode().slice(4);
const enc = (c: PrescriptionContent) => encryptField(JSON.stringify(c));
const dec = (s: string): PrescriptionContent => JSON.parse(decryptField(s));
const toRx = (r: typeof prescriptions.$inferSelect): Rx => ({ id: r.id, code: r.code, consultationId: r.consultationId, patientId: r.patientId, doctorUserId: r.doctorUserId, organizationId: r.organizationId, status: r.status, currentVersion: r.currentVersion, supersedesId: r.supersedesId, supersededById: r.supersededById, approvedAt: r.approvedAt, approvedBy: r.approvedBy, finalizedAt: r.finalizedAt, finalVersion: r.finalVersion, contentHash: r.contentHash, seal: r.seal, cancelReason: r.cancelReason, amendReason: r.amendReason });
const LIVE = ["draft", "approved", "finalized"];

export function drizzleRxRepo(db: Db = getDb()): RxRepo {
  const consults = drizzleConsultRepo(db), patients = drizzlePatientRepo(db);
  const versionRow = async (id: string, version: number) => {
    const [v] = await db.select().from(prescriptionVersions).where(and(eq(prescriptionVersions.prescriptionId, id), eq(prescriptionVersions.version, version))).limit(1);
    return v ? { version: v.version, kind: v.kind, content: dec(v.contentEnc), authorId: v.authorId } : null;
  };
  return {
    async consultation(id) {
      if (!UUID.test(id)) return null;
      const [c] = await db.select({ id: consultations.id, doctorUserId: consultations.doctorUserId, patientId: consultations.patientId, organizationId: consultations.organizationId, status: consultations.status }).from(consultations).where(eq(consultations.id, id)).limit(1);
      return c ?? null;
    },
    async noteContent(cid) { return (await consults.getNote(cid))?.content ?? null; },
    async patientFacts(patientId) {
      const p = await patients.getPatient(patientId);
      const items = await patients.listClinicalItems(patientId);
      return { name: p?.fullName ?? "", dob: p?.dob ?? "1900-01-01", sex: p?.sex ?? "unknown", allergies: items.filter((i) => i.kind === "allergy" && i.status === "active").map((i) => i.description), pregnant: null }; // pregnancy status is not recorded yet → unknown
    },
    async createOrGet(i) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const out = await db.transaction(async (tx) => {
          const [ins] = await tx.insert(prescriptions).values({ code: newRxCode(), consultationId: i.consultationId, patientId: i.patientId, doctorUserId: i.doctorUserId, organizationId: i.organizationId }).onConflictDoNothing().returning();
          if (ins) { await tx.insert(prescriptionVersions).values({ prescriptionId: ins.id, version: 1, kind: "edit", contentEnc: enc(i.content), authorId: i.createdBy }); return { row: toRx(ins), created: true }; }
          const [live] = await tx.select().from(prescriptions).where(and(eq(prescriptions.consultationId, i.consultationId), inArray(prescriptions.status, LIVE))).limit(1);
          return live ? { row: toRx(live), created: false } : null; // null → code collision, retry
        });
        if (out) return out;
      }
      throw new ConflictError("Could not create the prescription; please retry");
    },
    async get(id) { if (!UUID.test(id)) return null; const [r] = await db.select().from(prescriptions).where(eq(prescriptions.id, id)).limit(1); return r ? toRx(r) : null; },
    async latestContent(id) {
      const rx = await this.get(id); if (!rx) return null;
      const v = await versionRow(id, rx.currentVersion); return v ? { version: v.version, content: v.content } : null;
    },
    getVersion: (id, n) => versionRow(id, n),
    async saveVersion(v) {
      return db.transaction(async (tx) => {
        const [r] = await tx.update(prescriptions).set({ currentVersion: sql`${prescriptions.currentVersion} + 1`, updatedAt: new Date() })
          .where(and(eq(prescriptions.id, v.id), eq(prescriptions.currentVersion, v.baseVersion), eq(prescriptions.status, "draft"))).returning({ version: prescriptions.currentVersion });
        if (!r) throw new ConflictError("The prescription was changed elsewhere. Reload to see the latest version.");
        await tx.insert(prescriptionVersions).values({ prescriptionId: v.id, version: r.version, kind: "edit", contentEnc: enc(v.content), authorId: v.authorId });
        return { version: r.version };
      });
    },
    async setApproved(id, version, by) {
      const r = await db.update(prescriptions).set({ status: "approved", approvedBy: by, approvedAt: new Date(), updatedAt: new Date() }).where(and(eq(prescriptions.id, id), eq(prescriptions.status, "draft"), eq(prescriptions.currentVersion, version))).returning({ id: prescriptions.id });
      return r.length > 0;
    },
    async reopen(id) {
      const r = await db.update(prescriptions).set({ status: "draft", approvedBy: null, approvedAt: null, updatedAt: new Date() }).where(and(eq(prescriptions.id, id), eq(prescriptions.status, "approved"))).returning({ id: prescriptions.id });
      return r.length > 0;
    },
    async finalize(id, f) {
      const r = await db.update(prescriptions).set({ status: "finalized", finalVersion: f.version, finalizedAt: f.finalizedAt, contentHash: f.hash, seal: f.seal, updatedAt: new Date() })
        .where(and(eq(prescriptions.id, id), eq(prescriptions.status, "approved"), eq(prescriptions.currentVersion, f.version))).returning({ id: prescriptions.id });
      return r.length > 0;
    },
    async amend(id, a) {
      return db.transaction(async (tx) => {
        const newId = randomUUID(); // known up-front: a closed row cannot be updated afterwards, so the forward link is written with the supersede
        const [old] = await tx.update(prescriptions).set({ status: "superseded", amendReason: a.reason, supersededAt: new Date(), supersededById: newId, updatedAt: new Date() }).where(and(eq(prescriptions.id, id), eq(prescriptions.status, "finalized"))).returning();
        if (!old) return null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = newRxCode();
          const [ins] = await tx.insert(prescriptions).values({ id: newId, code, consultationId: old.consultationId, patientId: old.patientId, doctorUserId: old.doctorUserId, organizationId: old.organizationId, supersedesId: old.id }).onConflictDoNothing({ target: prescriptions.code }).returning({ id: prescriptions.id, code: prescriptions.code });
          if (!ins) continue;
          await tx.insert(prescriptionVersions).values({ prescriptionId: newId, version: 1, kind: "amendment_copy", contentEnc: enc(a.content), authorId: a.by });
          return { id: ins.id, code: ins.code };
        }
        throw new ConflictError("Could not create the amended prescription; please retry");
      });
    },
    async cancel(id, reason, by) {
      const r = await db.update(prescriptions).set({ status: "cancelled", cancelReason: reason, cancelledAt: new Date(), cancelledBy: by, updatedAt: new Date() }).where(and(eq(prescriptions.id, id), inArray(prescriptions.status, LIVE))).returning({ id: prescriptions.id });
      return r.length > 0;
    },
    async byCode(code) {
      const [r] = await db.select({ rx: prescriptions, name: users.fullName, bmdc: doctorProfiles.bmdcNumber, specialty: doctorProfiles.specialty }).from(prescriptions)
        .innerJoin(users, eq(users.id, prescriptions.doctorUserId)).innerJoin(doctorProfiles, eq(doctorProfiles.userId, prescriptions.doctorUserId)).where(eq(prescriptions.code, code)).limit(1);
      if (!r) return null;
      let supersededByCode: string | null = null;
      if (r.rx.supersededById) { const [n] = await db.select({ code: prescriptions.code }).from(prescriptions).where(eq(prescriptions.id, r.rx.supersededById)).limit(1); supersededByCode = n?.code ?? null; }
      const content = r.rx.finalVersion ? ((await versionRow(r.rx.id, r.rx.finalVersion))?.content ?? null) : null;
      return { rx: toRx(r.rx), doctor: { name: r.name, bmdc: r.bmdc, specialty: r.specialty }, supersededByCode, content };
    },
    async listByConsultation(cid) { return (await db.select().from(prescriptions).where(eq(prescriptions.consultationId, cid)).orderBy(asc(prescriptions.createdAt))).map(toRx); },
    async audit(e) { await db.insert(auditEvents).values({ action: e.action, actorId: e.actorId, organizationId: e.organizationId ?? null, resourceType: "prescription", resourceId: e.resourceId, metadata: e.metadata ?? {} }); },
  };
}
