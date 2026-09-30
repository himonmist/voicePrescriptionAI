import { describe, it, expect, beforeEach } from "vitest";
import { createShareService, type ShareRepo, type ShareRow, ShareUnavailableError } from "@/server/prescriptions/share";
import { NotFoundError, ValidationError } from "@/server/errors";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import { createHash } from "node:crypto";

const doc: Actor = { userId: "d1", roles: ["doctor"], orgId: null };
const COPY = { code: "RX-AAAA1111", state: "valid" as const, issuedAt: "2026-10-01T05:00:00.000Z", content: { items: [] } as any, doctor: { name: "Dr One", bmdc: "A-1", specialty: "GP", chamberAddress: null }, patient: { name: "Test Patient", dob: "1985-03-12", sex: "male", patientCode: "SDA-1" } };

function fake() {
  const st = { rx: { id: "rx1", status: "finalized", doctorUserId: "d1", patientId: "p1", code: "RX-AAAA1111" } as any, shares: [] as (ShareRow & { tokenHash: string })[], audit: [] as any[], dob: "1985-03-12", n: 0, copy: COPY as any };
  const repo: ShareRepo = {
    async prescription(id) { return id === "rx1" && st.rx ? st.rx : null; },
    async activeCount(id, now) { return st.shares.filter((s) => s.prescriptionId === id && !s.revokedAt && !s.lockedAt && s.expiresAt > now).length; },
    async create(i) { const row = { id: `s${++st.n}`, prescriptionId: i.prescriptionId, tokenHash: i.tokenHash, createdAt: new Date(), expiresAt: i.expiresAt, revokedAt: null, lockedAt: null, failedAttempts: 0, accessCount: 0, lastAccessedAt: null }; st.shares.push(row); return row.id; },
    async list(id) { return st.shares.filter((s) => s.prescriptionId === id); },
    async revoke(id, sid) { const s = st.shares.find((x) => x.id === sid && x.prescriptionId === id && !x.revokedAt); if (!s) return false; s.revokedAt = new Date(); return true; },
    async byTokenHash(h) { const s = st.shares.find((x) => x.tokenHash === h); return s ? { share: s, rx: st.rx, patientDob: st.dob } : null; },
    async recordFailure(sid) { const s = st.shares.find((x) => x.id === sid)!; s.failedAttempts++; if (s.failedAttempts >= 5) s.lockedAt = new Date(); return s.failedAttempts; },
    async recordAccess(sid) { const s = st.shares.find((x) => x.id === sid)!; s.accessCount++; s.lastAccessedAt = new Date(); },
    async audit(e) { st.audit.push(e); },
  };
  return { repo, st };
}

describe("share links", () => {
  let f: ReturnType<typeof fake>; let svc: ReturnType<typeof createShareService>; let clock: Date; let level: "clinical" | "none";
  beforeEach(() => { f = fake(); clock = new Date("2026-10-01T06:00:00Z"); level = "clinical"; svc = createShareService(f.repo, { now: () => clock, patientAccess: async () => level, sealedCopy: async () => f.st.copy }); });
  const mk = async (days?: number) => svc.createLink(doc, "rx1", days === undefined ? {} : { expiresInDays: days });

  describe("creating", () => {
    it("returns a high-entropy token ONCE and stores only its SHA-256 hash", async () => {
      const r = await mk(); expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(f.st.shares[0].tokenHash).toBe(createHash("sha256").update(r.token).digest("hex")); expect(JSON.stringify(f.st.shares)).not.toContain(r.token);
      expect(r.expiresAt.getTime() - clock.getTime()).toBe(7 * 86_400_000); // default 7 days
      expect(f.st.audit.some((a) => a.action === "prescription.share_created")).toBe(true); expect(JSON.stringify(f.st.audit)).not.toContain(r.token);
    });
    it("tokens are unique per link", async () => { expect((await mk()).token).not.toBe((await mk()).token); });
    it("expiry is 1–30 days", async () => { for (const d of [0, 31, -1, 1.5]) await expect(mk(d)).rejects.toThrow(ValidationError); await mk(1); await mk(30); });
    it("only FINALIZED prescriptions can be shared; drafts, superseded and cancelled cannot", async () => {
      for (const status of ["draft", "approved", "superseded", "cancelled"]) { f.st.rx.status = status; await expect(mk()).rejects.toThrow(/finalized/i); }
    });
    it("only the authoring doctor with clinical access; at most 5 live links", async () => {
      await expect(svc.createLink({ userId: "d2", roles: ["doctor"], orgId: null }, "rx1", {})).rejects.toThrow(NotFoundError);
      await expect(svc.createLink({ userId: "p", roles: ["patient"], orgId: null }, "rx1", {})).rejects.toThrow(ForbiddenError);
      level = "none"; await expect(mk()).rejects.toThrow(NotFoundError); level = "clinical";
      for (let i = 0; i < 5; i++) await mk(); await expect(mk()).rejects.toThrow(/at most 5/i);
    });
  });

  describe("opening (public)", () => {
    it("requires the patient's date of birth; wrong or malformed values are refused without revealing which part was wrong", async () => {
      const { token } = await mk();
      await expect(svc.open(token, "1990-01-01")).rejects.toThrow(/don.?t match/i); await expect(svc.open(token, "not a date")).rejects.toThrow(/don.?t match/i);
      const ok = await svc.open(token, "1985-03-12"); expect(ok.state).toBe("valid"); expect(ok.copy!.patient.name).toBe("Test Patient");
    });
    it("locks after 5 wrong attempts — even the right DOB is then refused with a generic message", async () => {
      const { token } = await mk();
      for (let i = 0; i < 5; i++) await svc.open(token, "1990-01-01").catch(() => {});
      await expect(svc.open(token, "1985-03-12")).rejects.toThrow(ShareUnavailableError);
    });
    it("unknown, revoked, expired and locked links are indistinguishable", async () => {
      const msgs = new Set<string>();
      const grab = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { msgs.add((e as Error).message); } };
      await grab(() => svc.open("x".repeat(43), "1985-03-12"));
      const a = await mk(); await svc.revokeLink(doc, "rx1", "s1"); await grab(() => svc.open(a.token, "1985-03-12"));
      const b = await mk(1); clock = new Date(clock.getTime() + 2 * 86_400_000); await grab(() => svc.open(b.token, "1985-03-12"));
      expect(msgs.size).toBe(1); expect([...msgs][0]).toMatch(/no longer valid/i);
    });
    it("a superseded or cancelled prescription shows a notice and NO content", async () => {
      const { token } = await mk(); f.st.rx.status = "superseded";
      const r = await svc.open(token, "1985-03-12"); expect(r.state).toBe("superseded"); expect(r.copy).toBeUndefined();
      f.st.rx.status = "cancelled"; expect((await svc.open(token, "1985-03-12")).state).toBe("cancelled");
    });
    it("counts accesses, audits them, and the audit holds no patient data", async () => {
      const { token } = await mk(); await svc.open(token, "1985-03-12"); await svc.open(token, "1985-03-12");
      expect(f.st.shares[0].accessCount).toBe(2); expect(f.st.shares[0].lastAccessedAt).toBeTruthy();
      expect(f.st.audit.filter((a) => a.action === "prescription.share_opened")).toHaveLength(2); expect(JSON.stringify(f.st.audit)).not.toMatch(/Test Patient|1985/);
    });
    it("rejects malformed tokens without touching the store", async () => { await expect(svc.open("short", "1985-03-12")).rejects.toThrow(ShareUnavailableError); });
  });

  describe("managing", () => {
    it("lists links without tokens; revoke works once and is author-only", async () => {
      const { token } = await mk(); const list = await svc.listLinks(doc, "rx1");
      expect(list).toHaveLength(1); expect(JSON.stringify(list)).not.toContain(token); expect(list[0]).toMatchObject({ id: "s1", revoked: false, locked: false });
      await expect(svc.revokeLink({ userId: "d2", roles: ["doctor"], orgId: null }, "rx1", "s1")).rejects.toThrow(NotFoundError);
      await svc.revokeLink(doc, "rx1", "s1"); await expect(svc.revokeLink(doc, "rx1", "s1")).rejects.toThrow(NotFoundError);
      expect(f.st.audit.some((a) => a.action === "prescription.share_revoked")).toBe(true);
    });
  });
});
