import { describe, it, expect, beforeEach } from "vitest";
import { createDrugService, type DrugRepo } from "@/server/drugs/service";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import { ValidationError, ConflictError } from "@/server/errors";

const admin: Actor = { userId: "a1", roles: ["super_admin"], orgId: null };
const doctor: Actor = { userId: "d1", roles: ["doctor"], orgId: null };
const SRC = { name: "TEST-SOURCE", version: "v1", publishedAt: "2026-01-15", licenceNote: "Synthetic test data, no licence needed" };
const DRUG = { genericName: "Testalpha", strength: "500 mg", dosageForm: "tablet" };

function fake() {
  const st = { imports: [] as any[], audit: [] as string[], drugs: 0, ix: 0, dup: false };
  const repo: DrugRepo = {
    async importReference(p, by) { if (st.dup) throw new ConflictError("This source version is already imported"); st.imports.push({ p, by }); st.drugs = p.drugs.length; st.ix = p.interactions.length; return { sourceId: "s1", drugCount: p.drugs.length, interactionCount: p.interactions.length }; },
    async search(q) { return q === "test" ? [{ id: "r1", genericName: "Testalpha", strength: "500 mg", dosageForm: "tablet", brandNames: [], sourceLabel: "TEST-SOURCE v1" } as any] : []; },
    async getMany() { return {}; },
    async interactionsFor() { return []; },
    async coverage() { return { sources: st.drugs ? [{ name: "TEST-SOURCE", version: "v1", publishedAt: "2026-01-15" }] : [], drugCount: st.drugs, interactionCount: st.ix }; },
    async audit(e) { st.audit.push(e.action); },
  };
  return { repo, st };
}

describe("drug reference service", () => {
  let f: ReturnType<typeof fake>; let svc: ReturnType<typeof createDrugService>;
  beforeEach(() => { f = fake(); svc = createDrugService(f.repo); });

  it("only a super admin may import, and the import is audited", async () => {
    await expect(svc.importReference(doctor, { source: SRC, drugs: [DRUG] })).rejects.toThrow(ForbiddenError);
    await expect(svc.importReference({ userId: "x", roles: ["finance"], orgId: null }, { source: SRC, drugs: [DRUG] })).rejects.toThrow(ForbiddenError);
    const r = await svc.importReference(admin, { source: SRC, drugs: [DRUG] });
    expect(r.drugCount).toBe(1); expect(f.st.audit).toContain("drugref.imported");
  });
  it("invalid imports never reach the repository", async () => {
    await expect(svc.importReference(admin, { source: { ...SRC, licenceNote: "" }, drugs: [DRUG] })).rejects.toThrow(ValidationError);
    expect(f.st.imports).toHaveLength(0);
  });
  it("re-importing the same source version conflicts", async () => { f.st.dup = true; await expect(svc.importReference(admin, { source: SRC, drugs: [DRUG] })).rejects.toThrow(ConflictError); });
  it("doctors can search; queries need 2+ characters; patients and admins cannot use the clinical search", async () => {
    expect((await svc.search(doctor, "test")).results).toHaveLength(1);
    await expect(svc.search(doctor, "t")).rejects.toThrow(ValidationError);
    await expect(svc.search({ userId: "p", roles: ["patient"], orgId: null }, "test")).rejects.toThrow(ForbiddenError);
    await expect(svc.search(admin, "test")).rejects.toThrow(ForbiddenError);
  });
  it("search output states when NO reference is loaded (never an empty 'all clear')", async () => {
    const r = await svc.search(doctor, "test");
    expect(r.coverage.loaded).toBe(false); expect(r.coverage.message).toMatch(/no drug reference/i);
  });
  it("coverage reports source, version and date once data is loaded", async () => {
    await svc.importReference(admin, { source: SRC, drugs: [DRUG] });
    const c = await svc.coverage(doctor);
    expect(c.loaded).toBe(true); expect(c.sources[0]).toMatchObject({ name: "TEST-SOURCE", version: "v1", publishedAt: "2026-01-15" });
    expect(c.interactionsLoaded).toBe(false); expect(c.message).toMatch(/interaction screening is unavailable/i);
  });
});
