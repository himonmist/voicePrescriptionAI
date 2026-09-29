import { describe, it, expect, beforeEach } from "vitest";
import { createConsultationService, type ConsultRepo, type Consultation, type NoteRow } from "@/server/consultations/service";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import type { AccessLevel } from "@/server/patients/access";

const doc = (id = "d1"): Actor => ({ userId: id, roles: ["doctor"], orgId: "orgA" });
const NOTE = { sections: { chiefComplaint: { state: "documented", text: "Fever 3 days" } } };

function fake() {
  const st = {
    consults: new Map<string, Consultation>(), appts: new Map<string, any>([["a1", { id: "a1", doctorUserId: "d1", patientId: "p1", organizationId: "orgA", status: "checked_in", mode: "in_person" }], ["a2", { id: "a2", doctorUserId: "d1", patientId: "p1", organizationId: "orgA", status: "booked", mode: "in_person" }], ["a3", { id: "a3", doctorUserId: "d2", patientId: "p1", organizationId: "orgA", status: "checked_in", mode: "in_person" }]]),
    segs: [] as any[], notes: new Map<string, NoteRow & { versions: any[] }>(), sessions: new Map<string, any>(), audit: [] as any[], n: 0, consent: true,
  };
  const repo: ConsultRepo = {
    async appointment(id) { return st.appts.get(id) ?? null; },
    async findByAppointment(id) { return [...st.consults.values()].find((c) => c.appointmentId === id) ?? null; },
    async findOpenWalkIn(d, p) { return [...st.consults.values()].find((c) => !c.appointmentId && c.doctorUserId === d && c.patientId === p && c.status === "in_progress") ?? null; },
    async createOrGet(i) {
      const existing = i.appointmentId ? [...st.consults.values()].find((c) => c.appointmentId === i.appointmentId) : [...st.consults.values()].find((c) => !c.appointmentId && c.doctorUserId === i.doctorUserId && c.patientId === i.patientId && c.status === "in_progress");
      if (existing) return { consultation: existing, created: false };
      const c: Consultation = { id: `c${++st.n}`, appointmentId: i.appointmentId, doctorUserId: i.doctorUserId, patientId: i.patientId, organizationId: i.organizationId, mode: i.mode, status: "in_progress", startedAt: new Date(), endedAt: null };
      st.consults.set(c.id, c); if (i.appointmentId) st.appts.get(i.appointmentId).status = "in_progress";
      return { consultation: c, created: true };
    },
    async get(id) { return st.consults.get(id) ?? null; },
    async complete(id) { const c = st.consults.get(id)!; c.status = "completed"; c.endedAt = new Date(); if (c.appointmentId) st.appts.get(c.appointmentId).status = "completed"; for (const s of st.sessions.values()) if (s.status !== "stopped") s.status = "stopped"; },
    async listSegments(cid) { return st.segs.filter((s) => s.consultationId === cid).sort((a, b) => a.seq - b.seq); },
    async addSegment(cid, s) { const seq = st.segs.filter((x) => x.consultationId === cid).length + 1; const row = { id: `s${++st.n}`, consultationId: cid, seq, flagged: false, originalText: null, ...s }; st.segs.push(row); return row; },
    async getSegment(cid, id) { return st.segs.find((s) => s.id === id && s.consultationId === cid) ?? null; },
    async updateSegment(cid, id, patch, editor) { const s = st.segs.find((x) => x.id === id && x.consultationId === cid)!; if (patch.text !== undefined && s.originalText === null) s.originalText = s.text; Object.assign(s, patch, { editedBy: editor }); return s; },
    async getNote(cid) { const n = st.notes.get(cid); return n ? { id: n.id, status: n.status, currentVersion: n.currentVersion, approvedBy: n.approvedBy, approvedAt: n.approvedAt, content: n.versions[n.versions.length - 1].content } : null; },
    async saveVersion(v) {
      let n = st.notes.get(v.consultationId);
      if (!n) { n = { id: `n${++st.n}`, status: "draft", currentVersion: 0, approvedBy: null, approvedAt: null, content: v.content, versions: [] } as any; st.notes.set(v.consultationId, n!); }
      if (n!.currentVersion !== v.baseVersion) throw new ConflictError("The note was changed elsewhere");
      n!.currentVersion++; n!.versions.push({ version: n!.currentVersion, kind: v.kind, content: v.content, authorId: v.authorId, summary: v.summary ?? null, createdAt: new Date() });
      return { version: n!.currentVersion };
    },
    async approveNote(cid, by) { const n = st.notes.get(cid)!; if (n.status === "approved") return false; n.status = "approved"; n.approvedBy = by; n.approvedAt = new Date(); return true; },
    async listVersions(cid) { return (st.notes.get(cid)?.versions ?? []).map((v) => ({ version: v.version, kind: v.kind, authorId: v.authorId, authorName: v.authorId, summary: v.summary, createdAt: v.createdAt })); },
    async getVersion(cid, ver) { return st.notes.get(cid)?.versions.find((v) => v.version === ver) ?? null; },
    async activeSession(cid) { return [...st.sessions.values()].find((s) => s.consultationId === cid && s.status !== "stopped") ?? null; },
    async startSession(i) { const s = { id: `r${++st.n}`, consultationId: i.consultationId, status: "active" }; st.sessions.set(s.id, s); return s.id; },
    async setSessionStatus(id, from, to) { const s = st.sessions.get(id); if (!s || s.status !== from) return false; s.status = to; return true; },
    async audit(e) { st.audit.push(e); },
  };
  return { repo, st };
}

describe("consultation service", () => {
  let f: ReturnType<typeof fake>; let svc: ReturnType<typeof createConsultationService>; let level: AccessLevel;
  beforeEach(() => {
    f = fake(); level = "clinical";
    svc = createConsultationService(f.repo, {
      patientAccess: async () => level, hasRecordingConsent: async () => f.st.consent,
      patientContext: async () => ({ name: "Test Patient", dob: "1985-03-12", sex: "male", allergies: ["Penicillin - rash"] }),
    });
  });

  describe("starting", () => {
    it("starts from a checked-in appointment and moves the appointment to in_progress", async () => {
      const r = await svc.start(doc(), { appointmentId: "a1" });
      expect(r.created).toBe(true); expect(f.st.appts.get("a1").status).toBe("in_progress");
      expect(f.st.audit.some((e) => e.action === "consultation.started")).toBe(true);
    });
    it("is idempotent: starting twice (double-click, two tabs) returns the SAME consultation", async () => {
      const a = await svc.start(doc(), { appointmentId: "a1" }); const b = await svc.start(doc(), { appointmentId: "a1" });
      expect(b.created).toBe(false); expect(b.consultationId).toBe(a.consultationId); expect(f.st.consults.size).toBe(1);
    });
    it("requires the patient to be checked in first; only the appointment's own doctor may start", async () => {
      await expect(svc.start(doc(), { appointmentId: "a2" })).rejects.toThrow(ValidationError);
      await expect(svc.start(doc(), { appointmentId: "a3" })).rejects.toThrow(NotFoundError);
      await expect(svc.start(doc(), { appointmentId: "nope" })).rejects.toThrow(NotFoundError);
    });
    it("only doctors start consultations", async () => {
      for (const roles of [["patient"], ["receptionist"], ["super_admin"], ["finance"]] as const) await expect(svc.start({ userId: "x", roles: [...roles], orgId: null }, { appointmentId: "a1" })).rejects.toThrow(ForbiddenError);
    });
    it("walk-in: needs clinical access to the patient; one open walk-in per doctor+patient", async () => {
      const a = await svc.start(doc(), { patientId: "p1" }); const b = await svc.start(doc(), { patientId: "p1" });
      expect(b.consultationId).toBe(a.consultationId);
      level = "demographics"; await expect(svc.start(doc(), { patientId: "p9" })).rejects.toThrow(NotFoundError);
      await expect(svc.start(doc(), {})).rejects.toThrow(ValidationError);
    });
  });

  describe("access (encounter-level)", () => {
    it("author sees the full workspace incl. allergies banner and recording-consent status", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: "a1" });
      const w = await svc.getWorkspace(doc(), consultationId);
      expect(w.access).toBe("author"); expect(w.patient.allergies).toEqual(["Penicillin - rash"]); expect(w.consent.recording).toBe(true); expect(w.segments).toEqual([]);
      expect(f.st.audit.some((e) => e.action === "consultation.viewed")).toBe(true);
    });
    it("another doctor with clinical access to the patient sees ONLY the approved note — no transcript", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: "a1" });
      await svc.addSegment(doc(), consultationId, { speaker: "patient", text: "I feel dizzy" });
      await svc.saveNote(doc(), consultationId, { baseVersion: 0, content: NOTE });
      const other = doc("d2");
      const draft = await svc.getWorkspace(other, consultationId);
      expect(draft.access).toBe("shared_read"); expect(draft.segments).toBeUndefined(); expect(draft.note).toBeNull();
      await svc.approveNote(doc(), consultationId);
      const approved = await svc.getWorkspace(other, consultationId);
      expect(approved.note?.content.sections.chiefComplaint.text).toBe("Fever 3 days"); expect(approved.segments).toBeUndefined();
    });
    it("doctors without patient access, and every non-doctor role, get 404", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: "a1" });
      level = "none";
      await expect(svc.getWorkspace(doc("d2"), consultationId)).rejects.toThrow(NotFoundError);
      for (const roles of [["patient"], ["receptionist"], ["super_admin"], ["support"]] as const) await expect(svc.getWorkspace({ userId: "x", roles: [...roles], orgId: "orgA" }, consultationId)).rejects.toThrow(NotFoundError);
    });
    it("non-authors cannot write transcript or notes", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: "a1" });
      await expect(svc.addSegment(doc("d2"), consultationId, { speaker: "doctor", text: "x" })).rejects.toThrow(ForbiddenError);
      await expect(svc.saveNote(doc("d2"), consultationId, { baseVersion: 0, content: NOTE })).rejects.toThrow(ForbiddenError);
      await expect(svc.complete(doc("d2"), consultationId)).rejects.toThrow(ForbiddenError);
    });
  });

  describe("transcript", () => {
    let cid: string; beforeEach(async () => { cid = (await svc.start(doc(), { appointmentId: "a1" })).consultationId; });
    it("adds ordered, attributed, timestamped segments", async () => {
      await svc.addSegment(doc(), cid, { speaker: "doctor", text: "What brings you in?", startMs: 0, endMs: 2500 });
      await svc.addSegment(doc(), cid, { speaker: "patient", text: "জ্বর আছে তিন দিন ধরে (fever for 3 days)", startMs: 2600, endMs: 6000 });
      const w = await svc.getWorkspace(doc(), cid);
      expect(w.segments!.map((s) => [s.seq, s.speaker])).toEqual([[1, "doctor"], [2, "patient"]]); expect(w.segments![1].text).toContain("জ্বর");
    });
    it("validates speaker, text, timestamps", async () => {
      await expect(svc.addSegment(doc(), cid, { speaker: "robot" as any, text: "x" })).rejects.toThrow(ValidationError);
      await expect(svc.addSegment(doc(), cid, { speaker: "doctor", text: "  " })).rejects.toThrow(ValidationError);
      await expect(svc.addSegment(doc(), cid, { speaker: "doctor", text: "x".repeat(5000) })).rejects.toThrow(ValidationError);
      await expect(svc.addSegment(doc(), cid, { speaker: "doctor", text: "x", startMs: 500, endMs: 100 })).rejects.toThrow(ValidationError);
    });
    it("editing preserves the ORIGINAL text; uncertain speech can be flagged", async () => {
      const s = await svc.addSegment(doc(), cid, { speaker: "patient", text: "take metfor min 500" });
      await svc.updateSegment(doc(), cid, s.id, { text: "takes metformin 500 mg", flagged: true });
      const seg = (await svc.getWorkspace(doc(), cid)).segments![0];
      expect(seg.text).toBe("takes metformin 500 mg"); expect(seg.originalText).toBe("take metfor min 500"); expect(seg.flagged).toBe(true);
    });
    it("a second edit keeps the FIRST original", async () => {
      const s = await svc.addSegment(doc(), cid, { speaker: "patient", text: "v1" });
      await svc.updateSegment(doc(), cid, s.id, { text: "v2" }); await svc.updateSegment(doc(), cid, s.id, { text: "v3" });
      expect((await svc.getWorkspace(doc(), cid)).segments![0].originalText).toBe("v1");
    });
    it("transcript is locked once the consultation is completed", async () => {
      const s = await svc.addSegment(doc(), cid, { speaker: "doctor", text: "hi" });
      await svc.complete(doc(), cid);
      await expect(svc.addSegment(doc(), cid, { speaker: "doctor", text: "late" })).rejects.toThrow(/completed/i);
      await expect(svc.updateSegment(doc(), cid, s.id, { text: "edit" })).rejects.toThrow(/completed/i);
    });
    it("unknown segment → 404", async () => { await expect(svc.updateSegment(doc(), cid, "zzz", { text: "x" })).rejects.toThrow(NotFoundError); });
  });

  describe("clinical note versions", () => {
    let cid: string; beforeEach(async () => { cid = (await svc.start(doc(), { appointmentId: "a1" })).consultationId; });
    it("first save creates v1; each save appends a new attributed version", async () => {
      expect((await svc.saveNote(doc(), cid, { baseVersion: 0, content: NOTE })).version).toBe(1);
      expect((await svc.saveNote(doc(), cid, { baseVersion: 1, content: { sections: { chiefComplaint: { state: "documented", text: "Fever 4 days" } } } })).version).toBe(2);
      const v = await svc.listVersions(doc(), cid); expect(v.map((x) => [x.version, x.kind])).toEqual([[1, "edit"], [2, "edit"]]);
    });
    it("optimistic locking: a stale tab cannot overwrite newer work", async () => {
      await svc.saveNote(doc(), cid, { baseVersion: 0, content: NOTE });
      await expect(svc.saveNote(doc(), cid, { baseVersion: 0, content: NOTE })).rejects.toThrow(ConflictError);
    });
    it("returns vital-sign review flags with the saved note", async () => {
      const r = await svc.saveNote(doc(), cid, { baseVersion: 0, content: { vitals: { tempC: 39.4 } } });
      expect(r.warnings.join(" ")).toMatch(/temperature/i);
    });
    it("invalid content is rejected and nothing is saved", async () => {
      await expect(svc.saveNote(doc(), cid, { baseVersion: 0, content: { sections: { hpi: { state: "documented", text: "" } } } })).rejects.toThrow(ValidationError);
      expect(await svc.listVersions(doc(), cid)).toEqual([]);
    });
    it("cannot approve an empty note or a non-existent one", async () => {
      await expect(svc.approveNote(doc(), cid)).rejects.toThrow(ValidationError);
      await svc.saveNote(doc(), cid, { baseVersion: 0, content: { vitals: { pulse: 70 } } });
      await expect(svc.approveNote(doc(), cid)).rejects.toThrow(/nothing to approve/i);
    });
    it("approval is attributed, audited, and single-shot", async () => {
      await svc.saveNote(doc(), cid, { baseVersion: 0, content: NOTE });
      await svc.approveNote(doc(), cid);
      const w = await svc.getWorkspace(doc(), cid); expect(w.note?.status).toBe("approved"); expect(w.note?.approvedBy).toBe("d1");
      expect(f.st.audit.some((e) => e.action === "note.approved")).toBe(true);
      await expect(svc.approveNote(doc(), cid)).rejects.toThrow(ValidationError);
    });
    it("editing an APPROVED note requires an amendment reason and creates an 'amendment' version (original preserved)", async () => {
      await svc.saveNote(doc(), cid, { baseVersion: 0, content: NOTE }); await svc.approveNote(doc(), cid);
      const changed = { sections: { chiefComplaint: { state: "documented", text: "Fever 3 days, with rash" } } };
      await expect(svc.saveNote(doc(), cid, { baseVersion: 1, content: changed })).rejects.toThrow(/amendment/i);
      await expect(svc.saveNote(doc(), cid, { baseVersion: 1, content: changed, amendmentReason: "short" })).rejects.toThrow(ValidationError);
      await svc.saveNote(doc(), cid, { baseVersion: 1, content: changed, amendmentReason: "Rash noticed after examination" });
      const v = await svc.listVersions(doc(), cid); expect(v[1]).toMatchObject({ version: 2, kind: "amendment", summary: "Rash noticed after examination" });
      expect((await svc.getVersion(doc(), cid, 1)).content.sections.chiefComplaint.text).toBe("Fever 3 days"); // original intact
    });
  });

  describe("recording consent gate", () => {
    let cid: string; beforeEach(async () => { cid = (await svc.start(doc(), { appointmentId: "a1" })).consultationId; });
    it("cannot start recording without recorded consent; nothing is created", async () => {
      f.st.consent = false;
      await expect(svc.recording(doc(), cid, "start")).rejects.toThrow(/consent/i);
      expect(f.st.sessions.size).toBe(0);
    });
    it("start → pause → resume → stop, each audited; only one open session", async () => {
      await svc.recording(doc(), cid, "start");
      await expect(svc.recording(doc(), cid, "start")).rejects.toThrow(ConflictError);
      await svc.recording(doc(), cid, "pause"); await svc.recording(doc(), cid, "resume"); await svc.recording(doc(), cid, "stop");
      expect(f.st.audit.filter((e) => e.action.startsWith("recording.")).map((e) => e.action)).toEqual(["recording.start", "recording.pause", "recording.resume", "recording.stop"]);
    });
    it("resume re-checks consent (withdrawn mid-session)", async () => {
      await svc.recording(doc(), cid, "start"); await svc.recording(doc(), cid, "pause");
      f.st.consent = false;
      await expect(svc.recording(doc(), cid, "resume")).rejects.toThrow(/consent/i);
      await svc.recording(doc(), cid, "stop"); // stopping is always allowed
    });
    it("illegal actions are rejected (pause with nothing running, unknown action)", async () => {
      await expect(svc.recording(doc(), cid, "pause")).rejects.toThrow(ValidationError);
      await expect(svc.recording(doc(), cid, "explode" as any)).rejects.toThrow(ValidationError);
    });
    it("no recording after the consultation is completed", async () => {
      await svc.complete(doc(), cid); await expect(svc.recording(doc(), cid, "start")).rejects.toThrow(/completed/i);
    });
  });

  describe("completion", () => {
    it("completes the consultation, stops any recording, and completes the linked appointment", async () => {
      const { consultationId } = await svc.start(doc(), { appointmentId: "a1" });
      await svc.recording(doc(), consultationId, "start");
      await svc.complete(doc(), consultationId);
      expect(f.st.consults.get(consultationId)!.status).toBe("completed"); expect(f.st.appts.get("a1").status).toBe("completed");
      expect([...f.st.sessions.values()].every((s) => s.status === "stopped")).toBe(true);
      await expect(svc.complete(doc(), consultationId)).rejects.toThrow(ValidationError);
    });
    it("a manual workflow is never blocked: completion does not require a note or recording", async () => {
      const { consultationId } = await svc.start(doc(), { patientId: "p1" });
      await svc.complete(doc(), consultationId);
      expect(f.st.consults.get(consultationId)!.status).toBe("completed");
    });
  });
});
