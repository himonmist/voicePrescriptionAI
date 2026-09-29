import { z } from "zod";
import { isValidDate } from "@/lib/time";
import { ValidationError } from "@/server/errors";
import { collapse, normalizeIngredient, stripTags } from "./normalize";

const text = (max: number) => z.string().max(max).transform((s) => collapse(stripTags(s))).nullish().transform((s) => (s ? s : null));
const name = (max: number) => z.string().transform((s) => collapse(stripTags(s))).pipe(z.string().min(1).max(max));
const list = (max: number, itemMax: number) => z.array(name(itemMax)).max(max).optional().default([]);

const drugSchema = z.object({
  genericName: name(200), strength: name(100), dosageForm: name(80), route: text(60),
  ingredients: list(30, 200), brandNames: list(50, 200), drugClasses: list(20, 100), highRisk: z.boolean().optional().default(false),
  indications: text(2000), contraindications: text(2000), warnings: text(2000), pediatricCaution: text(1000), pregnancyCaution: text(1000), renalNote: text(1000), hepaticNote: text(1000),
});
const SEVERITIES = ["minor", "moderate", "major", "contraindicated"] as const;
const interactionSchema = z.object({ ingredientA: name(200), ingredientB: name(200), severity: z.enum(SEVERITIES), description: name(1000), management: text(1000) });
const sourceSchema = z.object({
  name: name(100), version: name(50), publishedAt: z.string().refine(isValidDate, "publishedAt must be a valid YYYY-MM-DD date"),
  licenceNote: z.string().transform((s) => collapse(stripTags(s))).pipe(z.string().min(10, "State the licence or authorization under which this data is used (min 10 characters)").max(500)),
});
const importSchema = z.object({ source: sourceSchema, drugs: z.array(drugSchema).min(1, "Import at least one drug").max(5000, "At most 5000 drugs per import"), interactions: z.array(interactionSchema).max(50_000).optional().default([]) });

export interface ParsedDrug { genericName: string; ingredients: string[]; brandNames: string[]; drugClasses: string[]; strength: string; dosageForm: string; route: string | null; highRisk: boolean; indications: string | null; contraindications: string | null; warnings: string | null; pediatricCaution: string | null; pregnancyCaution: string | null; renalNote: string | null; hepaticNote: string | null; searchText: string }
export interface ParsedInteraction { ingredientA: string; ingredientB: string; severity: (typeof SEVERITIES)[number]; description: string; management: string | null }
export interface ParsedImport { source: z.output<typeof sourceSchema>; drugs: ParsedDrug[]; interactions: ParsedInteraction[] }

const uniq = (xs: string[], key: (s: string) => string) => { const seen = new Set<string>(); return xs.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

/** Validates an import of AUTHORIZED reference data. This module never contains or generates drug data. */
export function parseDrugImport(raw: unknown): ParsedImport {
  const r = importSchema.safeParse(raw);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid import");
  const drugs = r.data.drugs.map((d): ParsedDrug => {
    const ingredients = uniq((d.ingredients.length ? d.ingredients : [d.genericName]).map(normalizeIngredient), (s) => s);
    const brandNames = uniq(d.brandNames, (s) => s.toLowerCase());
    return { ...d, ingredients, brandNames, searchText: [d.genericName, ...brandNames, ...ingredients].join(" ").toLowerCase() };
  });
  const best = new Map<string, ParsedInteraction>();
  for (const x of r.data.interactions) {
    const [a, b] = [normalizeIngredient(x.ingredientA), normalizeIngredient(x.ingredientB)].sort();
    if (a === b) throw new ValidationError("An interaction must involve two different ingredients");
    const k = `${a}|${b}`, cur = best.get(k);
    if (!cur || SEVERITIES.indexOf(x.severity) > SEVERITIES.indexOf(cur.severity)) best.set(k, { ingredientA: a, ingredientB: b, severity: x.severity, description: x.description, management: x.management });
  }
  return { source: r.data.source, drugs, interactions: [...best.values()] };
}
