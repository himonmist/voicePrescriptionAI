import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { auditEvents, drugInteractions, drugReferenceSources, drugReferences } from "@/db/schema";
import { ConflictError } from "@/server/errors";
import type { DrugRepo, DrugRow } from "./service";
import type { Interaction, RefDrug } from "./safety";

const CHUNK = 500;
const codeOf = (e: unknown): string | undefined => (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
const label = (name: string, version: string) => `${name} ${version}`;

export function drizzleDrugRepo(db: Db = getDb()): DrugRepo {
  return {
    async importReference(p, importedBy) {
      try {
        return await db.transaction(async (tx) => {
          await tx.update(drugReferenceSources).set({ status: "superseded" }).where(and(eq(drugReferenceSources.name, p.source.name), eq(drugReferenceSources.status, "active")));
          const [src] = await tx.insert(drugReferenceSources).values({ ...p.source, importedBy, drugCount: p.drugs.length, interactionCount: p.interactions.length }).returning({ id: drugReferenceSources.id });
          for (let i = 0; i < p.drugs.length; i += CHUNK) await tx.insert(drugReferences).values(p.drugs.slice(i, i + CHUNK).map((d) => ({ ...d, sourceId: src.id })));
          for (let i = 0; i < p.interactions.length; i += CHUNK) await tx.insert(drugInteractions).values(p.interactions.slice(i, i + CHUNK).map((x) => ({ ...x, sourceId: src.id })));
          return { sourceId: src.id, drugCount: p.drugs.length, interactionCount: p.interactions.length };
        });
      } catch (e) { if (codeOf(e) === "23505") throw new ConflictError("This source version has already been imported"); throw e; }
    },
    async search(q, limit) {
      const rows = await db.select({ d: drugReferences, name: drugReferenceSources.name, version: drugReferenceSources.version, date: drugReferenceSources.publishedAt })
        .from(drugReferences).innerJoin(drugReferenceSources, eq(drugReferenceSources.id, drugReferences.sourceId))
        .where(and(eq(drugReferenceSources.status, "active"), like(drugReferences.searchText, "%" + escapeLike(q.toLowerCase()) + "%"))).orderBy(drugReferences.genericName).limit(limit);
      return rows.map((r): DrugRow => ({ id: r.d.id, genericName: r.d.genericName, ingredients: r.d.ingredients, brandNames: r.d.brandNames, drugClasses: r.d.drugClasses, strength: r.d.strength, dosageForm: r.d.dosageForm, route: r.d.route, highRisk: r.d.highRisk, indications: r.d.indications, contraindications: r.d.contraindications, warnings: r.d.warnings, pediatricCaution: r.d.pediatricCaution, pregnancyCaution: r.d.pregnancyCaution, renalNote: r.d.renalNote, hepaticNote: r.d.hepaticNote, sourceLabel: label(r.name, r.version), sourceDate: r.date }));
    },
    async getMany(ids) {
      const valid = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
      if (!valid.length) return {};
      const rows = await db.select({ d: drugReferences, name: drugReferenceSources.name, version: drugReferenceSources.version }).from(drugReferences).innerJoin(drugReferenceSources, eq(drugReferenceSources.id, drugReferences.sourceId)).where(inArray(drugReferences.id, valid));
      return Object.fromEntries(rows.map((r): [string, RefDrug] => [r.d.id, { id: r.d.id, genericName: r.d.genericName, ingredients: r.d.ingredients, drugClasses: r.d.drugClasses, highRisk: r.d.highRisk, pediatricCaution: r.d.pediatricCaution, pregnancyCaution: r.d.pregnancyCaution, sourceLabel: label(r.name, r.version) }]));
    },
    async interactionsFor(ingredients) {
      const set = [...new Set(ingredients)]; if (set.length < 2) return [];
      const rows = await db.select({ x: drugInteractions, name: drugReferenceSources.name, version: drugReferenceSources.version }).from(drugInteractions).innerJoin(drugReferenceSources, eq(drugReferenceSources.id, drugInteractions.sourceId))
        .where(and(eq(drugReferenceSources.status, "active"), inArray(drugInteractions.ingredientA, set), inArray(drugInteractions.ingredientB, set)));
      return rows.map((r): Interaction => ({ a: r.x.ingredientA, b: r.x.ingredientB, severity: r.x.severity as Interaction["severity"], description: r.x.description, sourceLabel: label(r.name, r.version) }));
    },
    async coverage() {
      const rows = await db.select({ name: drugReferenceSources.name, version: drugReferenceSources.version, publishedAt: drugReferenceSources.publishedAt, drugs: drugReferenceSources.drugCount, ix: drugReferenceSources.interactionCount }).from(drugReferenceSources).where(eq(drugReferenceSources.status, "active"));
      return { sources: rows.map((r) => ({ name: r.name, version: r.version, publishedAt: r.publishedAt })), drugCount: rows.reduce((s, r) => s + r.drugs, 0), interactionCount: rows.reduce((s, r) => s + r.ix, 0) };
    },
    async audit(e) { await db.insert(auditEvents).values({ action: e.action, actorId: e.actorId, resourceType: "drug_reference", resourceId: e.resourceId, metadata: e.metadata ?? {} }); },
  };
}
