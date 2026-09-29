import { describe, it, expect, beforeEach } from "vitest";
import { createPrescriptionService, type RxRepo, type Rx } from "@/server/prescriptions/service";
import { computeHash, verifySeal } from "@/server/prescriptions/seal";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import { MemoryRateLimiter } from "@/lib/security/rate-limit";
import { parseNoteInput } from "@/server/consultations/note";
import type { PrescriptionContent } from "@/server/prescriptions/content";
import type { RefDrug } from "@/server/drugs/safety";

process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");
const doc = (id = "d1"): Actor => ({ userId: id, roles: ["doctor"], orgId: "orgA" });
const REF_ID = "3f2b8c1e-0000-4000-8000-0000000000a1", REF2_ID = "3f2b8c1e-0000-4000-8000-0000000000a2";
const OK = { genericName: "Testalpha", strength: "500 mg", dosageForm: "tablet", route: "oral", dose: "1 tablet", frequency: "twice daily", duration: { value: 5, unit: "days" } };
const ref = (id: string, name: string, o: Partial<RefDrug> = {}): RefDrug => ({ id, genericName: name, ingredients: [name.toLowerCase()], drugClasses: [], highRisk: false, pediatricCaution: null, pregnancyCaution: null, sourceLabel: "TEST-SOURCE v1", ...o });

function fake() {
  const st = {
    rx: new Map<string, Rx & { versions: { version: number; kind: string; content: PrescriptionContent; authorId: string }[] }>(), n: 0, audit: [] as any[],
    consult: { id: "c1", doctorUserId: "d1", patientId: "p1", organizationId: "orgA", status: "in_progress" } as any,
    note: null as any, allergies: [] as string[], refs: {} as Record<string, RefDrug>, ixLoaded: false, drugsLoaded: false, passwordOk: true, tamper: false,
  };
  const latest = (r: any) => r.versions[r.versions.length - 1];
  const repo: RxRepo = {
    async consultation(id) { return id === st.consult.id ? st.consult : null; },
    async noteContent() { return st.note; },
    async patientFacts() { return { name: "Test Patient", dob: "1985-03-12", sex: "male", allergies: st.allergies, pregnant: null }; },
    async createOrGet(i) {
      const live = [...st.rx.values()].find((r) => r.consultationId === i.consultationId && ["draft", "approved", "finalized"].includes(r.status));
      if (live) return { row: live, created: false };
      const id = `rx${++st.n}`; const row: any = { id, code: `RX-CODE${st.n}`, consultationId: i.consultationId, patientId: i.patientId, doctorUserId: i.doctorUserId, organizationId: i.organizationId, status: "draft", currentVersion: 1, supersedesId: null, supersededById: null, approvedAt: null, approvedBy: null, finalizedAt: null, finalVersion: null, contentHash: null, seal: null, cancelReason: null, amendReason: null, versions: [{ version: 1, kind: "edit", content: i.content, authorId: i.createdBy }] };
      st.rx.set(id, row); return { row, created: true };
    },
    async get(id) { return st.rx.get(id) ?? null; },
    async latestContent(id) { const r = st.rx.get(id); return r ? { version: r.currentVersion, content: latest(r).content } : null; },
    async getVersion(id, n) { return st.rx.get(id)?.versions.find((v) => v.version === n) ?? null; },
    async saveVersion(v) { const r = st.rx.get(v.id)!; if (r.status !== "draft" || r.currentVersion !== v.baseVersion) throw new ConflictError("changed elsewhere"); r.currentVersion++; r.versions.push({ version: r.currentVersion, kind: "edit", content: v.content, authorId: v.authorId }); return { version: r.currentVersion }; },
    async setApproved(id, version, by) { const r = st.rx.get(id)!; if (r.status !== "draft" || r.currentVersion !== version) return false; r.status = "approved"; r.approvedBy = by; r.approvedAt = new Date(); return true; },
    async reopen(id) { const r = st.rx.get(id)!; if (r.status !== "approved") return false; r.status = "draft"; return true; },
    async finalize(id, f) { const r = st.rx.get(id)!; if (r.status !== "approved" || r.currentVersion !== f.version) return false; Object.assign(r, { status: "finalized", finalVersion: f.version, finalizedAt: f.finalizedAt, contentHash: f.hash, seal: f.seal }); return true; },
    async amend(id, a) { const old = st.rx.get(id)!; if (old.status !== "finalized") return null; old.status = "superseded"; old.amendReason = a.reason; const nid = `rx${++st.n}`; const row: any = { ...old, id: nid, code: `RX-CODE${st.n}`, status: "draft", currentVersion: 1, supersedesId: id, supersededById: null, finalizedAt: null, finalVersion: null, contentHash: null, seal: null, approvedAt: null, approvedBy: null, amendReason: null, versions: [{ version: 1, kind: "amendment_copy", content: a.content, authorId: a.by }] }; old.supersededById = nid; st.rx.set(nid, row); return { id: nid, code: row.code }; },
    async cancel(id, reason) { const r = st.rx.get(id)!; if (!["draft", "approved", "finalized"].includes(r.status)) return false; r.status = "cancelled"; r.cancelReason = reason; return true; },
    async byCode(code) {
      const r = [...st.rx.values()].find((x) => x.code === code); if (!r) return null;
      const v = r.finalVersion ? r.versions.find((x) => x.version === r.finalVersion) : null;
      const content = v ? (st.tamper ? { ...v.content, advice: "TAMPERED" } : v.content) : null;
      return { rx: r, doctor: { name: "Dr One", bmdc: "A-1001", specialty: "GP" }, supersededByCode: r.supersededById ? st.rx.get(r.supersededById)!.code : null, content };
    },
    async listByConsultation(cid) { return [...st.rx.values()].filter((r) => r.consultationId === cid); },
    async audit(e) { st.audit.push(e); },
  };
  return { repo, st };
}

describe("prescription service", () => {
  let f: ReturnType<typeof fake>; let svc: ReturnType<typeof createPrescriptionService>; let level: "clinical" | "none"; let clock: Date;
  beforeEach(() => {
    f = fake(); level = "clinical"; clock = new Date("2026-10-01T05:00:00Z");
    svc = createPrescriptionService(f.repo, {
      patientAccess: async () => level, now: () => clock, limiter: new MemoryRateLimiter(() => clock.getTime()),
      checkPassword: async () => f.st.passwordOk,
      drugs: { screeningData: async () => ({ refs: f.st.refs, interactions: [], coverage: { drugs: f.st.drugsLoaded, interactions: f.st.ixLoaded }, description: { loaded: f.st.drugsLoaded, interactionsLoaded: f.st.ixLoaded, sources: [], message: "m" } }) },
    });
  });
  const draft = async () => (await svc.createDraft(doc(), "c1")).prescriptionId;
  const fill = async (id: string, content: object, base?: number) => svc.saveDraft(doc(), id, { baseVersion: base ?? (await f.repo.get(id))!.currentVersion, content });
  async function ready(id?: string) { id ??= await draft(); await fill(id, { items: [OK] }); return id; }

  describe("creating", () => {
    it("pre-fills from the note (factual carry-over) and the patient's allergies; no drugs or advice are invented", async () => {
      f.st.note = parseNoteInput({ sections: { chiefComplaint: { state: "documented", text: "Fever" }, plan: { state: "documented", text: "Paracetamol" } }, diagnoses: [{ text: "Viral fever", status: "provisional" }] }); f.st.allergies = ["Penicillin - rash"];
      const { prescriptionId } = await svc.createDraft(doc(), "c1");
      const v = await svc.get(doc(), prescriptionId);
      expect(v.content).toMatchObject({ chiefComplaint: "Fever", allergiesSnapshot: ["Penicillin - rash"], items: [], advice: "" }); expect(v.content.diagnoses[0]).toEqual({ text: "Viral fever", status: "provisional" });
    });
    it("is idempotent per consultation (double click / two tabs)", async () => {
      const a = await svc.createDraft(doc(), "c1"), b = await svc.createDraft(doc(), "c1");
      expect(b.created).toBe(false); expect(b.prescriptionId).toBe(a.prescriptionId); expect(f.st.rx.size).toBe(1);
    });
    it("only the consultation's doctor with clinical access may create; everyone else 404/403", async () => {
      await expect(svc.createDraft(doc("d2"), "c1")).rejects.toThrow(NotFoundError);
      level = "none"; await expect(svc.createDraft(doc(), "c1")).rejects.toThrow(NotFoundError); level = "clinical";
      for (const roles of [["patient"], ["receptionist"], ["super_admin"], ["finance"]] as const) await expect(svc.createDraft({ userId: "x", roles: [...roles], orgId: null }, "c1")).rejects.toThrow(ForbiddenError);
      await expect(svc.createDraft(doc(), "nope")).rejects.toThrow(NotFoundError);
    });
    it("refuses for a cancelled consultation", async () => { f.st.consult.status = "cancelled"; await expect(svc.createDraft(doc(), "c1")).rejects.toThrow(ValidationError); });
  });

  describe("editing", () => {
    it("saves versions with optimistic locking", async () => {
      const id = await draft();
      expect((await fill(id, { items: [OK] })).version).toBe(2);
      await expect(svc.saveDraft(doc(), id, { baseVersion: 1, content: { items: [] } })).rejects.toThrow(ConflictError);
    });
    it("rejects invalid content and edits by non-authors", async () => {
      const id = await draft();
      await expect(fill(id, { items: [{ genericName: "" }] })).rejects.toThrow(ValidationError);
      await expect(svc.saveDraft(doc("d2"), id, { baseVersion: 1, content: {} })).rejects.toThrow(NotFoundError);
    });
    it("cannot edit once approved — the doctor must reopen first", async () => {
      const id = await ready(); await svc.approve(doc(), id);
      await expect(fill(id, { items: [] })).rejects.toThrow(/reopen/i);
    });
  });

  describe("approval (doctor review)", () => {
    it("is blocked while required fields are missing, listing what is missing", async () => {
      const id = await draft(); await fill(id, { items: [{ genericName: "Testbeta" }] });
      await expect(svc.approve(doc(), id)).rejects.toThrow(/Item 1 \(Testbeta\): missing/);
    });
    it("is blocked while any field is flagged as needing confirmation", async () => {
      const id = await draft(); await fill(id, { items: [{ ...OK, unresolved: ["dose"] }] });
      await expect(svc.approve(doc(), id)).rejects.toThrow(/needs confirmation/i);
    });
    it("nothing to prescribe cannot be approved", async () => { await expect(svc.approve(doc(), await draft())).rejects.toThrow(/nothing to prescribe/i); });
    it("approves a complete prescription, attributed and audited; cannot approve twice", async () => {
      const id = await ready(); await svc.approve(doc(), id);
      const r = await f.repo.get(id); expect(r).toMatchObject({ status: "approved", approvedBy: "d1" }); expect(f.st.audit.some((a) => a.action === "prescription.approved")).toBe(true);
      await expect(svc.approve(doc(), id)).rejects.toThrow(ValidationError);
    });
    it("reopen returns an approved prescription to draft (audited); finalized cannot be reopened", async () => {
      const id = await ready(); await svc.approve(doc(), id); await svc.reopen(doc(), id);
      expect((await f.repo.get(id))!.status).toBe("draft"); expect(f.st.audit.some((a) => a.action === "prescription.reopened")).toBe(true);
      await svc.approve(doc(), id); await svc.finalize(doc(), id, { password: "pw" });
      await expect(svc.reopen(doc(), id)).rejects.toThrow(ValidationError);
    });
  });

  describe("safety alerts gate approval", () => {
    beforeEach(() => { f.st.refs = { [REF_ID]: ref(REF_ID, "Testalpha", { drugClasses: ["testcillin"] }) }; f.st.drugsLoaded = true; });
    const linked = { ...OK, drugRefId: REF_ID };
    it("an allergy match blocks approval until the doctor documents a justified override", async () => {
      f.st.allergies = ["Testcillin - rash"]; const id = await draft();
      await fill(id, { items: [linked] });
      const v = await svc.get(doc(), id); const a = v.screening.alerts.find((x) => x.kind === "allergy")!;
      expect(a.requiresOverride).toBe(true); expect(v.screening.overridesNeeded).toEqual([a.key]);
      await expect(svc.approve(doc(), id)).rejects.toThrow(/1 safety alert/i);
      await fill(id, { items: [linked], overrides: [{ alertKey: a.key, reason: "Tolerated previously; benefit outweighs risk, counselled" }] });
      await svc.approve(doc(), id); expect((await f.repo.get(id))!.status).toBe("approved");
    });
    it("an override for an alert that no longer exists does not help with a different alert", async () => {
      f.st.allergies = ["Testcillin - rash"]; const id = await draft();
      await fill(id, { items: [linked], overrides: [{ alertKey: "allergy:0:something-else", reason: "A long enough reason here" }] });
      await expect(svc.approve(doc(), id)).rejects.toThrow(/safety alert/i);
    });
    it("informational alerts and screening limits never block", async () => {
      f.st.allergies = []; const id = await draft(); await fill(id, { items: [{ ...OK }] }); // unlinked → warning only
      const v = await svc.get(doc(), id); expect(v.screening.alerts.some((a) => a.kind === "unlinked")).toBe(true); expect(v.screening.overridesNeeded).toEqual([]);
      await svc.approve(doc(), id);
    });
    it("the screening result always states what was NOT checked", async () => {
      const v = await svc.get(doc(), await draft()); expect(v.screening.limits.join(" ")).toMatch(/renal and hepatic/i); expect(v.screening.limits.join(" ")).toMatch(/interaction screening was not performed/i);
    });
  });

  describe("finalization (signing)", () => {
    it("requires an approved prescription and the doctor's password (step-up), then seals it", async () => {
      const id = await ready();
      await expect(svc.finalize(doc(), id, { password: "pw" })).rejects.toThrow(/approve/i);
      await svc.approve(doc(), id);
      f.st.passwordOk = false; await expect(svc.finalize(doc(), id, { password: "wrong" })).rejects.toThrow(/password/i); expect((await f.repo.get(id))!.status).toBe("approved");
      f.st.passwordOk = true;
      const r = await svc.finalize(doc(), id, { password: "pw" });
      const row = (await f.repo.get(id))!;
      expect(row.status).toBe("finalized"); expect(row.finalizedAt).toEqual(clock); expect(r.code).toBe(row.code);
      const h = computeHash({ code: row.code, doctorUserId: "d1", patientId: "p1", consultationId: "c1", version: row.finalVersion!, finalizedAt: clock.toISOString(), content: (await f.repo.getVersion(id, row.finalVersion!))!.content });
      expect(row.contentHash).toBe(h); expect(verifySeal(h, row.seal!)).toBe(true);
      expect(f.st.audit.some((a) => a.action === "prescription.finalized")).toBe(true);
    });
    it("throttles wrong-password attempts", async () => {
      const id = await ready(); await svc.approve(doc(), id); f.st.passwordOk = false;
      for (let i = 0; i < 5; i++) await svc.finalize(doc(), id, { password: "x" }).catch(() => {});
      f.st.passwordOk = true; await expect(svc.finalize(doc(), id, { password: "right" })).rejects.toThrow(/too many/i);
    });
    it("re-screens at signing: an allergy recorded AFTER approval blocks finalization", async () => {
      f.st.refs = { [REF_ID]: ref(REF_ID, "Testalpha", { drugClasses: ["testcillin"] }) }; f.st.drugsLoaded = true;
      const id = await draft(); await fill(id, { items: [{ ...OK, drugRefId: REF_ID }] }); await svc.approve(doc(), id);
      f.st.allergies = ["Testcillin - anaphylaxis"];
      await expect(svc.finalize(doc(), id, { password: "pw" })).rejects.toThrow(/safety review changed|reopen/i);
      expect((await f.repo.get(id))!.status).toBe("approved");
    });
    it("only the author can finalize", async () => {
      const id = await ready(); await svc.approve(doc(), id);
      await expect(svc.finalize(doc("d2"), id, { password: "pw" })).rejects.toThrow(NotFoundError);
    });
  });

  describe("finalized prescriptions are immutable; corrections are amendments", () => {
    async function finalized() { const id = await ready(); await svc.approve(doc(), id); await svc.finalize(doc(), id, { password: "pw" }); return id; }
    it("editing or approving a finalized prescription is refused", async () => {
      const id = await finalized();
      await expect(fill(id, { items: [] })).rejects.toThrow(ValidationError); await expect(svc.approve(doc(), id)).rejects.toThrow(ValidationError);
    });
    it("amend requires a reason, supersedes the original, creates a NEW draft with a NEW code and clears overrides", async () => {
      const id = await finalized();
      await expect(svc.amend(doc(), id, { reason: "short" })).rejects.toThrow(ValidationError);
      const a = await svc.amend(doc(), id, { reason: "Dose corrected after re-checking the chart" });
      const old = (await f.repo.get(id))!; const neu = (await f.repo.get(a.prescriptionId))!;
      expect(old.status).toBe("superseded"); expect(old.supersededById).toBe(a.prescriptionId); expect(old.amendReason).toBe("Dose corrected after re-checking the chart");
      expect(neu.status).toBe("draft"); expect(neu.code).not.toBe(old.code); expect(neu.supersedesId).toBe(id);
      expect((await svc.get(doc(), a.prescriptionId)).content.items[0].genericName).toBe("Testalpha");
      expect(f.st.audit.some((x) => x.action === "prescription.amended")).toBe(true);
    });
    it("only finalized prescriptions can be amended", async () => { await expect(svc.amend(doc(), await ready(), { reason: "Trying to amend a draft" })).rejects.toThrow(ValidationError); });
    it("cancel needs a reason, works on drafts and finalized prescriptions, and is terminal", async () => {
      const id = await finalized();
      await expect(svc.cancel(doc(), id, { reason: "x" })).rejects.toThrow(ValidationError);
      await svc.cancel(doc(), id, { reason: "Issued to the wrong patient" });
      expect((await f.repo.get(id))!.status).toBe("cancelled");
      await expect(svc.cancel(doc(), id, { reason: "Trying to cancel twice" })).rejects.toThrow(ValidationError);
      await expect(svc.amend(doc(), id, { reason: "Trying to amend cancelled" })).rejects.toThrow(ValidationError);
    });
  });

  describe("public verification (no patient data)", () => {
    async function finalized() { const id = await ready(); await svc.approve(doc(), id); await svc.finalize(doc(), id, { password: "pw" }); return (await f.repo.get(id))!.code; }
    it("valid: shows doctor, registration, date and intact integrity — and NO patient information", async () => {
      const code = await finalized(); const v = await svc.verify(code);
      expect(v).toMatchObject({ status: "valid", integrity: "valid", doctorName: "Dr One", bmdc: "A-1001", issuedAt: clock.toISOString() });
      expect(JSON.stringify(v)).not.toMatch(/Test Patient|1985|Testalpha|p1/);
    });
    it("detects content that no longer matches its seal", async () => { const code = await finalized(); f.st.tamper = true; expect((await svc.verify(code)).integrity).toBe("invalid"); });
    it("superseded and cancelled are reported as such; drafts/unknown codes are indistinguishable 'not found'", async () => {
      const id = await ready(); await svc.approve(doc(), id); await svc.finalize(doc(), id, { password: "pw" }); const code = (await f.repo.get(id))!.code;
      const a = await svc.amend(doc(), id, { reason: "Dose corrected after re-checking the chart" });
      const sup = await svc.verify(code); expect(sup.status).toBe("superseded"); expect(sup.supersededByCode).toBe((await f.repo.get(a.prescriptionId))!.code);
      await expect(svc.verify((await f.repo.get(a.prescriptionId))!.code)).rejects.toThrow(NotFoundError); // still a draft
      await expect(svc.verify("RX-NOPE0000")).rejects.toThrow(NotFoundError);
      const id2 = await (async () => { f.st.consult.status = "in_progress"; const b = await f.repo.createOrGet({ consultationId: "c2", patientId: "p1", doctorUserId: "d1", organizationId: null, content: (await f.repo.latestContent(id))!.content, createdBy: "d1" }); return b.row.id; })();
      void id2;
    });
    it("cancelled prescriptions verify as cancelled without disclosing the reason", async () => {
      const id = await ready(); await svc.approve(doc(), id); await svc.finalize(doc(), id, { password: "pw" }); const code = (await f.repo.get(id))!.code;
      await svc.cancel(doc(), id, { reason: "Issued to the wrong patient" });
      const v = await svc.verify(code); expect(v.status).toBe("cancelled"); expect(JSON.stringify(v)).not.toMatch(/wrong patient/);
    });
  });

  describe("reading", () => {
    it("only the author sees a prescription; the read is audited", async () => {
      const id = await draft(); await svc.get(doc(), id);
      expect(f.st.audit.some((a) => a.action === "prescription.viewed")).toBe(true);
      await expect(svc.get(doc("d2"), id)).rejects.toThrow(NotFoundError);
      await expect(svc.get({ userId: "p", roles: ["patient"], orgId: null }, id)).rejects.toThrow(NotFoundError);
    });
  });
});
