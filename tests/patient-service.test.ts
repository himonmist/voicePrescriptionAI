import { describe, it, expect, beforeEach } from "vitest";
import { createPatientService, type PatientRepo, type PatientRecord } from "@/server/patients/service";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import { NotFoundError, ConflictError, ValidationError } from "@/server/errors";
import type { Relationship } from "@/server/patients/access";
import { normalizeName, phoneBlindIndex } from "@/lib/security/pii";

process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

type P = PatientRecord & { phoneIdx: string | null; createdBy: string };
function fake() {
  const patients = new Map<string, P>(); const rels: (Relationship & { patientId: string })[] = [];
  const consents: any[] = []; const items: any[] = []; const audit: any[] = []; const merges: any[] = [];
  const doctors = new Map<string, { status: string; orgId: string | null }>([["d1", { status: "active", orgId: "orgA" }], ["d2", { status: "active", orgId: "orgB" }], ["d3", { status: "under_review", orgId: "orgA" }], ["d4", { status: "active", orgId: "orgA" }]]);
  let n = 0;
  const repo: PatientRepo = {
    async doctorStatus(id) { return doctors.get(id)?.status ?? null; },
    async isDoctorInOrg(id, org) { return doctors.get(id)?.orgId === org; },
    async candidates(scope, _probe) {
      return [...patients.values()].filter((p) => p.status === "active" && (scope.kind === "org" ? p.organizationId === scope.orgId : rels.some((r) => r.patientId === p.id && r.doctorUserId === scope.doctorUserId && !r.revokedAt)))
        .map((p) => ({ id: p.id, patientCode: p.patientCode, fullNameNorm: normalizeName(p.fullName), dob: p.dob, phoneIdx: p.phoneIdx }));
    },
    async createPatient(i) {
      const id = `p${++n}`; const rec: P = { id, organizationId: i.organizationId, patientCode: `SDA-${n}`, fullName: i.fullName, dob: i.dob, sex: i.sex, phone: i.phone ?? null, email: i.email ?? null, address: i.address ?? null, emergencyContact: i.emergencyContact ?? null, userId: null, status: "active", phoneIdx: i.phone ? phoneBlindIndex(i.phone) : null, createdBy: i.createdBy };
      patients.set(id, rec);
      if (i.treatingDoctorUserId) rels.push({ patientId: id, doctorUserId: i.treatingDoctorUserId, kind: "treating", expiresAt: null, revokedAt: null });
      return { id, patientCode: rec.patientCode };
    },
    async getPatient(id) { return patients.get(id) ?? null; },
    async relationshipsFor(id) { return rels.filter((r) => r.patientId === id); },
    async search(scope, q) { return [...patients.values()].filter((p) => p.fullName.toLowerCase().includes(q.toLowerCase()) && (scope.kind === "org" ? p.organizationId === scope.orgId : rels.some((r) => r.patientId === p.id && r.doctorUserId === scope.doctorUserId && !r.revokedAt))).map((p) => ({ id: p.id, patientCode: p.patientCode, fullName: p.fullName, dob: p.dob, sex: p.sex })); },
    async addConsent(c) { consents.push(c); },
    async latestConsents(id) { const m = new Map<string, any>(); consents.filter((c) => c.patientId === id).forEach((c) => m.set(c.kind, c)); return [...m.values()]; },
    async addClinicalItem(i) { items.push({ ...i, id: `i${items.length + 1}`, status: "active" }); return `i${items.length}`; },
    async listClinicalItems(id) { return items.filter((i) => i.patientId === id); },
    async setClinicalItemStatus(pid, iid, status, reason) { const i = items.find((x) => x.id === iid && x.patientId === pid); if (!i) return false; i.status = status; i.statusReason = reason; return true; },
    async grantAccess(g) { rels.push({ patientId: g.patientId, doctorUserId: g.doctorUserId, kind: "shared", expiresAt: g.expiresAt, revokedAt: null }); },
    async revokeAccess(pid, did) { const r = rels.find((x) => x.patientId === pid && x.doctorUserId === did && !x.revokedAt); if (r) r.revokedAt = new Date(); return !!r; },
    async merge(m) { patients.get(m.sourceId)!.status = "merged"; merges.push(m); },
    async audit(e) { audit.push(e); },
  };
  return { repo, patients, rels, consents, items, audit, merges };
}

const doc = (id: string, orgId: string | null = "orgA"): Actor => ({ userId: id, roles: ["doctor"], orgId });
const recep = (orgId: string | null = "orgA"): Actor => ({ userId: "r1", roles: ["receptionist"], orgId });
const input = { fullName: "Md Rahim Uddin", dob: "1985-03-12", sex: "male", phone: "01712345678" };

describe("patient service", () => {
  let f: ReturnType<typeof fake>; let svc: ReturnType<typeof createPatientService>;
  beforeEach(() => { f = fake(); svc = createPatientService(f.repo); });

  describe("creation", () => {
    it("doctor creates a patient and becomes the treating doctor; audit has no PHI", async () => {
      const r = await svc.createPatient(doc("d1"), input);
      expect(f.rels[0]).toMatchObject({ doctorUserId: "d1", kind: "treating" });
      expect(f.patients.get(r.patientId)!.organizationId).toBe("orgA");
      const a = f.audit.find((e) => e.action === "patient.created");
      expect(JSON.stringify(a)).not.toMatch(/Rahim|01712345678|1985/);
    });
    it("unverified doctors cannot create patients", async () => {
      await expect(svc.createPatient(doc("d3"), input)).rejects.toThrow(ForbiddenError);
    });
    it("non-clinical roles cannot create patients", async () => {
      for (const roles of [["patient"], ["super_admin"], ["finance"], ["support"], ["content_manager"]] as const)
        await expect(svc.createPatient({ userId: "x", roles: [...roles], orgId: "orgA" }, input)).rejects.toThrow(ForbiddenError);
    });
    it("receptionist must name a doctor from the same org", async () => {
      await expect(svc.createPatient(recep(), input)).rejects.toThrow(ValidationError);
      await expect(svc.createPatient(recep(), input, { forDoctorUserId: "d2" })).rejects.toThrow(ValidationError); // d2 is in orgB
      await expect(svc.createPatient(recep(), input, { forDoctorUserId: "d3" })).rejects.toThrow(ValidationError); // unverified
      const r = await svc.createPatient(recep(), input, { forDoctorUserId: "d1" });
      expect(f.rels.find((x) => x.patientId === r.patientId)!.doctorUserId).toBe("d1");
    });
    it("receptionist without an organization cannot register patients", async () => {
      await expect(svc.createPatient(recep(null), input, { forDoctorUserId: "d1" })).rejects.toThrow(ForbiddenError);
    });
    it("rejects invalid input (future dob, bad phone)", async () => {
      await expect(svc.createPatient(doc("d1"), { ...input, dob: "2999-01-01" })).rejects.toThrow(ValidationError);
      await expect(svc.createPatient(doc("d1"), { ...input, phone: "123" })).rejects.toThrow(ValidationError);
    });
  });

  describe("duplicate detection", () => {
    it("blocks a duplicate unless the clinician explicitly confirms", async () => {
      await svc.createPatient(doc("d1"), input);
      const err = await svc.createPatient(doc("d1"), input).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.duplicates[0].level).toBe("strong");
      const ok = await svc.createPatient(doc("d1"), input, { confirmNotDuplicate: true });
      expect(ok.patientId).toBeTruthy();
    });
    it("does NOT reveal patients belonging to other doctors", async () => {
      await svc.createPatient(doc("d1"), input);
      const r = await svc.createPatient(doc("d4"), input); // d4 has no relationship to d1's patient
      expect(r.patientId).toBeTruthy();
    });
  });

  describe("reading a record", () => {
    it("treating doctor sees clinical view and the read is audited", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), { ...input, email: "a@b.com" });
      const v = await svc.getPatient(doc("d1"), patientId);
      expect(v.level).toBe("clinical"); expect(v.clinical).toBeDefined();
      expect(f.audit.some((e) => e.action === "patient.viewed" && e.resourceId === patientId)).toBe(true);
    });
    it("same-org doctor without relationship gets 404 (existence not revealed)", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      await expect(svc.getPatient(doc("d4"), patientId)).rejects.toThrow(NotFoundError);
    });
    it("receptionist sees demographics only — no clinical block", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      const v = await svc.getPatient(recep(), patientId);
      expect(v.level).toBe("demographics"); expect(v.clinical).toBeUndefined();
    });
    it("other-org receptionist and admins get 404", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      await expect(svc.getPatient(recep("orgB"), patientId)).rejects.toThrow(NotFoundError);
      await expect(svc.getPatient({ userId: "a", roles: ["super_admin"], orgId: null }, patientId)).rejects.toThrow(NotFoundError);
    });
    it("suspended/unverified doctor loses access immediately", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      (await f.repo.doctorStatus("d1")); // still active
      f.rels.push({ patientId, doctorUserId: "d3", kind: "shared", expiresAt: null, revokedAt: null });
      await expect(svc.getPatient(doc("d3"), patientId)).rejects.toThrow(NotFoundError);
    });
  });

  describe("search", () => {
    it("doctor search is limited to own patients; receptionist to own org", async () => {
      await svc.createPatient(doc("d1"), input);
      await svc.createPatient(doc("d2", "orgB"), { ...input, fullName: "Md Rahim Other", phone: "01812345678", dob: "1990-01-01" });
      expect((await svc.search(doc("d1"), "rahim")).map((x) => x.fullName)).toEqual(["Md Rahim Uddin"]);
      expect((await svc.search(recep("orgB"), "rahim")).map((x) => x.fullName)).toEqual(["Md Rahim Other"]);
    });
    it("search results contain no contact details", async () => {
      await svc.createPatient(doc("d1"), input);
      expect(JSON.stringify(await svc.search(doc("d1"), "rahim"))).not.toMatch(/01712345678|phone|email/i);
    });
    it("rejects too-short queries and unauthorized roles", async () => {
      await expect(svc.search(doc("d1"), "a")).rejects.toThrow(ValidationError);
      await expect(svc.search({ userId: "p", roles: ["patient"], orgId: null }, "rahim")).rejects.toThrow(ForbiddenError);
    });
  });

  describe("consent", () => {
    it("records history and current state is the latest", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      await svc.recordConsent(doc("d1"), patientId, { kind: "recording", granted: true, method: "in_person" });
      expect(await svc.hasActiveConsent(patientId, "recording")).toBe(true);
      await svc.recordConsent(doc("d1"), patientId, { kind: "recording", granted: false, method: "in_person", note: "withdrawn" });
      expect(await svc.hasActiveConsent(patientId, "recording")).toBe(false);
      expect(f.consents).toHaveLength(2);
      expect(f.consents[0].policyVersion).toBeTruthy();
    });
    it("no consent means no consent (never assumed)", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      expect(await svc.hasActiveConsent(patientId, "recording")).toBe(false);
    });
    it("unrelated doctors cannot record consent", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      await expect(svc.recordConsent(doc("d4"), patientId, { kind: "recording", granted: true, method: "in_person" })).rejects.toThrow(NotFoundError);
    });
    it("linked patient can manage own consent digitally", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      f.patients.get(patientId)!.userId = "pu1";
      await svc.recordConsent({ userId: "pu1", roles: ["patient"], orgId: null }, patientId, { kind: "sms", granted: false, method: "digital" });
      expect(f.consents[0]).toMatchObject({ method: "digital", capturedBy: "pu1" });
    });
    it("rejects unknown consent kinds", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      await expect(svc.recordConsent(doc("d1"), patientId, { kind: "everything", granted: true, method: "in_person" } as any)).rejects.toThrow(ValidationError);
    });
  });

  describe("clinical items", () => {
    it("only clinically-authorized doctors can add; receptionists cannot", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      await svc.addClinicalItem(doc("d1"), patientId, { kind: "allergy", description: "Penicillin - rash", severity: "moderate" });
      await expect(svc.addClinicalItem(recep(), patientId, { kind: "allergy", description: "x" })).rejects.toThrow(ForbiddenError);
      expect((await svc.getPatient(doc("d1"), patientId)).clinical!.items).toHaveLength(1);
    });
    it("items are never deleted: resolving requires a reason and keeps the row", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      const id = await svc.addClinicalItem(doc("d1"), patientId, { kind: "condition", description: "Hypertension" });
      await expect(svc.setClinicalItemStatus(doc("d1"), patientId, id, "entered_in_error", "")).rejects.toThrow(ValidationError);
      await svc.setClinicalItemStatus(doc("d1"), patientId, id, "entered_in_error", "wrong patient");
      expect(f.items[0].status).toBe("entered_in_error");
    });
    it("audit records item kind but not the description", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      await svc.addClinicalItem(doc("d1"), patientId, { kind: "allergy", description: "Penicillin - anaphylaxis" });
      expect(JSON.stringify(f.audit)).not.toMatch(/Penicillin/);
    });
  });

  describe("sharing between doctors", () => {
    it("treating doctor can share; shared doctor then has access until expiry", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      await svc.shareAccess(doc("d1"), patientId, { doctorUserId: "d4", reason: "Cardiology referral", expiresInDays: 30 });
      expect((await svc.getPatient(doc("d4"), patientId)).level).toBe("clinical");
      expect(f.audit.some((e) => e.action === "patient.access_granted")).toBe(true);
    });
    it("shared doctors cannot re-share; others cannot share at all", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      await svc.shareAccess(doc("d1"), patientId, { doctorUserId: "d4", reason: "Referral", expiresInDays: 30 });
      await expect(svc.shareAccess(doc("d4"), patientId, { doctorUserId: "d2", reason: "Referral", expiresInDays: 30 })).rejects.toThrow(ForbiddenError);
      await expect(svc.shareAccess(recep(), patientId, { doctorUserId: "d4", reason: "Referral", expiresInDays: 30 })).rejects.toThrow(ForbiddenError);
    });
    it("cannot share with an unverified doctor, oneself, or without a reason; expiry is capped", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      await expect(svc.shareAccess(doc("d1"), patientId, { doctorUserId: "d3", reason: "Referral", expiresInDays: 30 })).rejects.toThrow(ValidationError);
      await expect(svc.shareAccess(doc("d1"), patientId, { doctorUserId: "d1", reason: "Referral", expiresInDays: 30 })).rejects.toThrow(ValidationError);
      await expect(svc.shareAccess(doc("d1"), patientId, { doctorUserId: "d4", reason: "", expiresInDays: 30 })).rejects.toThrow(ValidationError);
      await expect(svc.shareAccess(doc("d1"), patientId, { doctorUserId: "d4", reason: "Referral", expiresInDays: 400 })).rejects.toThrow(ValidationError);
    });
    it("shared doctor or treating doctor can revoke; access ends immediately", async () => {
      const { patientId } = await svc.createPatient(doc("d1"), input);
      await svc.shareAccess(doc("d1"), patientId, { doctorUserId: "d4", reason: "Referral", expiresInDays: 30 });
      await svc.revokeAccess(doc("d1"), patientId, "d4");
      await expect(svc.getPatient(doc("d4"), patientId)).rejects.toThrow(NotFoundError);
    });
  });

  describe("merge", () => {
    async function two() {
      const a = await svc.createPatient(doc("d1"), input);
      const b = await svc.createPatient(doc("d1"), { ...input, fullName: "Rahim Uddin" }, { confirmNotDuplicate: true });
      return { a: a.patientId, b: b.patientId };
    }
    it("requires treating access to BOTH, a reason, and distinct records; source becomes inaccessible", async () => {
      const { a, b } = await two();
      await expect(svc.mergePatients(doc("d1"), a, a, "same record twice")).rejects.toThrow(ValidationError);
      await expect(svc.mergePatients(doc("d1"), a, b, "dup")).rejects.toThrow(ValidationError);
      await expect(svc.mergePatients(doc("d4"), a, b, "duplicate registration")).rejects.toThrow(NotFoundError);
      await svc.mergePatients(doc("d1"), a, b, "Duplicate registration confirmed");
      await expect(svc.getPatient(doc("d1"), a)).rejects.toThrow(NotFoundError);
      expect(f.merges).toHaveLength(1);
      expect(f.audit.some((e) => e.action === "patient.merged")).toBe(true);
    });
  });
});
