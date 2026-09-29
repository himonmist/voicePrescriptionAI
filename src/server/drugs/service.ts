import { assertCan, ForbiddenError, type Actor } from "@/lib/security/rbac";
import { ValidationError } from "@/server/errors";
import { parseDrugImport, type ParsedImport } from "./import";
import { normalizeIngredient } from "./normalize";
import type { Interaction, RefDrug } from "./safety";

export interface DrugRow { id: string; genericName: string; ingredients: string[]; brandNames: string[]; drugClasses: string[]; strength: string; dosageForm: string; route: string | null; highRisk: boolean; indications: string | null; contraindications: string | null; warnings: string | null; pediatricCaution: string | null; pregnancyCaution: string | null; renalNote: string | null; hepaticNote: string | null; sourceLabel: string; sourceDate: string }
export interface Coverage { sources: { name: string; version: string; publishedAt: string }[]; drugCount: number; interactionCount: number }

export interface DrugRepo {
  /** Atomic. Supersedes earlier active versions of the same source; throws ConflictError if this name+version exists. */
  importReference(p: ParsedImport, importedBy: string): Promise<{ sourceId: string; drugCount: number; interactionCount: number }>;
  search(q: string, limit: number): Promise<DrugRow[]>;
  /** Resolves ids from ANY source version so existing prescriptions keep their original provenance. */
  getMany(ids: string[]): Promise<Record<string, RefDrug>>;
  /** Interactions from ACTIVE sources where both ingredients are in the given set. */
  interactionsFor(ingredients: string[]): Promise<Interaction[]>;
  coverage(): Promise<Coverage>;
  audit(e: { action: string; actorId: string; resourceId?: string; metadata?: Record<string, unknown> }): Promise<void>;
}

function describe(c: Coverage) {
  const loaded = c.drugCount > 0, interactionsLoaded = c.interactionCount > 0;
  const message = !loaded
    ? "No drug reference is loaded. Drug information, class-based allergy checks and interaction screening are unavailable; only name matching against the patient's recorded allergies is performed."
    : `Reference: ${c.sources.map((s) => `${s.name} ${s.version} (${s.publishedAt})`).join("; ")}.${interactionsLoaded ? "" : " Interaction screening is unavailable: no interaction data is loaded."}`;
  return { loaded, interactionsLoaded, sources: c.sources, message };
}

export function createDrugService(repo: DrugRepo) {
  const requireDoctor = (a: Actor) => { if (!a.roles.includes("doctor")) throw new ForbiddenError("consultation:read"); };
  return {
    async importReference(actor: Actor, raw: unknown) {
      assertCan(actor, "drugref:manage");
      const parsed = parseDrugImport(raw);
      const r = await repo.importReference(parsed, actor.userId);
      await repo.audit({ action: "drugref.imported", actorId: actor.userId, resourceId: r.sourceId, metadata: { source: parsed.source.name, version: parsed.source.version, drugs: r.drugCount, interactions: r.interactionCount } });
      return r;
    },
    async search(actor: Actor, q: string) {
      requireDoctor(actor);
      const term = (q ?? "").trim();
      if (term.length < 2) throw new ValidationError("Enter at least 2 characters");
      const [results, cov] = await Promise.all([repo.search(term, 25), repo.coverage()]);
      return { results, coverage: describe(cov) };
    },
    async coverage(actor: Actor) {
      if (!actor.roles.includes("doctor") && !actor.roles.includes("super_admin")) throw new ForbiddenError("consultation:read");
      return describe(await repo.coverage());
    },
    /** Data the safety engine needs for a prescription. `coverage` tells the engine what could NOT be checked. */
    async screeningData(refIds: string[], names: string[]) {
      const refs = await repo.getMany([...new Set(refIds)]);
      const ingredients = new Set<string>(names.map(normalizeIngredient));
      for (const r of Object.values(refs)) for (const i of r.ingredients) ingredients.add(normalizeIngredient(i));
      const [interactions, cov] = await Promise.all([repo.interactionsFor([...ingredients]), repo.coverage()]);
      return { refs, interactions, coverage: { drugs: cov.drugCount > 0, interactions: cov.interactionCount > 0 }, description: describe(cov) };
    },
  };
}
