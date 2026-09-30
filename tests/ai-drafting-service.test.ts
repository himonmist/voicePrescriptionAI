import { describe, it, expect, beforeEach, vi } from "vitest";
import { createDraftingService, type DraftingDeps } from "@/server/ai/drafting";
import { providerFromEnv } from "@/server/ai/provider";
import { NotFoundError, UnavailableError, ValidationError } from "@/server/errors";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import { emptyNote } from "@/server/consultations/note";

const doc: Actor = { userId: "d1", roles: ["doctor"], orgId: null };
const GOOD = JSON.stringify({ sections: { chiefComplaint: { text: "Fever for 3 days", evidence: ["fever for three days"] }, allergies: { text: "None", evidence: ["no allergies"] } }, diagnoses: [], uncertain: ["Duration unclear"] });

function setup(over: Partial<{ status: string; note: any; consent: boolean; out: string | Error; segs: any[]; allowed: boolean; provider: boolean; doctor: string; level: string }> = {}) {
  const st = { note: over.note ?? null, saved: [] as any[], audit: [] as any[], usage: [] as any[] };
  const repo: any = {
    async get() { return { id: "c1", doctorUserId: over.doctor ?? "d1", patientId: "p1", status: over.status ?? "in_progress" }; },
    async getNote() { return st.note; }, async listSegments() { return over.segs ?? [{ id: "s1", speaker: "patient", text: "I have fever for three days" }]; },
    async saveVersion(v: any) { st.saved.push(v); return { version: (st.note?.currentVersion ?? 0) + 1 }; }, async audit(e: any) { st.audit.push(e); },
  };
  const provider = over.provider === false ? null : { name: "test", model: "m", complete: vi.fn(async () => { if (over.out instanceof Error) throw over.out; return { text: (over.out as string) ?? GOOD, inputTokens: 100, outputTokens: 50 }; }) };
  const deps: DraftingDeps = { provider, patientAccess: async () => (over.level ?? "clinical") as any, hasConsent: async () => over.consent ?? true, limiter: { hit: () => ({ allowed: over.allowed ?? true, remaining: 1, retryAfterMs: 0 }) as any }, recordUsage: async (u) => { st.usage.push(u); }, now: () => 1000 };
  return { svc: createDraftingService(repo, deps), st, provider };
}

describe("AI drafting service", () => {
  it("saves a grounded draft with ai_draft provenance, records usage, audits without clinical text", async () => {
    const { svc, st } = setup(); const r = await svc.draftNote(doc, "c1");
    expect(r).toMatchObject({ saved: true, filled: ["chiefComplaint"] }); expect(r.dropped.map((d) => d.item)).toEqual(["allergies"]); expect(r.uncertain).toEqual(["Duration unclear"]);
    expect(st.saved[0].content.sections.chiefComplaint.origin).toBe("ai_draft"); expect(st.saved[0].summary).toMatch(/unreviewed/i);
    expect(st.usage[0]).toMatchObject({ status: "ok", inputTokens: 100, outputTokens: 50 }); expect(JSON.stringify(st.audit)).not.toMatch(/Fever|fever/);
  });
  it("keeps doctor-written text", async () => {
    const n = emptyNote(); n.sections.chiefComplaint = { state: "documented", text: "Mine", sources: [], origin: "manual" };
    const { svc, st } = setup({ note: { status: "draft", currentVersion: 2, content: n } }); const r = await svc.draftNote(doc, "c1");
    expect(r.saved).toBe(false); expect(r.skipped).toEqual(["chiefComplaint"]); expect(st.saved).toHaveLength(0);
  });
  it("refuses without ai_processing consent, on approved notes, completed consultations, empty transcripts, and when rate limited", async () => {
    await expect(setup({ consent: false }).svc.draftNote(doc, "c1")).rejects.toThrow(/consented/);
    await expect(setup({ note: { status: "approved", currentVersion: 1, content: emptyNote() } }).svc.draftNote(doc, "c1")).rejects.toThrow(/approved/);
    await expect(setup({ status: "completed" }).svc.draftNote(doc, "c1")).rejects.toThrow(ValidationError);
    await expect(setup({ segs: [] }).svc.draftNote(doc, "c1")).rejects.toThrow(/no transcript/);
    await expect(setup({ allowed: false }).svc.draftNote(doc, "c1")).rejects.toThrow(/limit/);
  });
  it("only the authoring doctor with clinical access", async () => {
    await expect(setup({ doctor: "other" }).svc.draftNote(doc, "c1")).rejects.toThrow(ForbiddenError);
    await expect(setup({ level: "none" }).svc.draftNote(doc, "c1")).rejects.toThrow(NotFoundError);
    await expect(setup().svc.draftNote({ userId: "p", roles: ["patient"], orgId: null }, "c1")).rejects.toThrow(NotFoundError);
  });
  it("no provider configured → 503-type error, no fabricated draft", async () => {
    const { svc } = setup({ provider: false }); expect(svc.available()).toBe(false); await expect(svc.draftNote(doc, "c1")).rejects.toThrow(UnavailableError);
    expect(providerFromEnv({})).toBeNull(); expect(providerFromEnv({ ANTHROPIC_API_KEY: "k" })?.name).toBe("anthropic");
  });
  it("provider failure or garbage output saves nothing and is recorded", async () => {
    const a = setup({ out: new Error("boom") }); await expect(a.svc.draftNote(doc, "c1")).rejects.toThrow(UnavailableError); expect(a.st.saved).toHaveLength(0); expect(a.st.usage[0].status).toBe("failed");
    const b = setup({ out: "I cannot help with that" }); await expect(b.svc.draftNote(doc, "c1")).rejects.toThrow(/unusable/); expect(b.st.saved).toHaveLength(0); expect(b.st.usage[0].status).toBe("rejected");
  });
});
