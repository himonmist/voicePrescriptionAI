import { normalizeIngredient } from "./normalize";

export type Severity = "info" | "warning" | "high" | "critical";
export type AlertKind = "unlinked" | "allergy" | "duplicate_ingredient" | "interaction" | "high_risk" | "pediatric" | "pregnancy";
export interface Alert { key: string; kind: AlertKind; severity: Severity; itemIndexes: number[]; message: string; source?: string; requiresOverride: boolean }

export interface RefDrug { id: string; genericName: string; ingredients: string[]; drugClasses: string[]; highRisk: boolean; pediatricCaution: string | null; pregnancyCaution: string | null; sourceLabel: string }
export interface Interaction { a: string; b: string; severity: "minor" | "moderate" | "major" | "contraindicated"; description: string; sourceLabel: string }
export interface ScreenItem { drugRefId?: string | null; genericName: string; brandName?: string | null }
export interface ScreenInput {
  items: ScreenItem[]; refs: Record<string, RefDrug>; interactions: Interaction[]; allergies: string[];
  patient: { ageYears: number | null; sex: string; pregnant: boolean | null };
  coverage: { drugs: boolean; interactions: boolean };
}
export interface ScreenResult { alerts: Alert[]; limits: string[] }

const RANK: Record<Severity, number> = { critical: 0, high: 1, warning: 2, info: 3 };
const IX_SEVERITY = { contraindicated: "critical", major: "high", moderate: "warning", minor: "info" } as const;
const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9ঀ-৿]+/).filter((t) => t.length >= 4);

/**
 * Decision SUPPORT only. It never authorizes anything and never reports the absence of a problem:
 * `limits` always states what was not screened. Every check is driven by loaded, sourced reference
 * data or by the patient's recorded allergies — nothing is inferred by a model.
 */
export function screenPrescription(input: ScreenInput): ScreenResult {
  const { items, refs, allergies, patient } = input;
  const alerts: Alert[] = [];
  const meta = items.map((it) => {
    const ref = it.drugRefId ? refs[it.drugRefId] : undefined;
    const name = normalizeIngredient(it.genericName);
    return { it, ref, name, ingredients: ref ? ref.ingredients.map(normalizeIngredient) : [name], hay: [name, it.brandName ? normalizeIngredient(it.brandName) : "", ...(ref ? ref.ingredients.map(normalizeIngredient) : []), ...(ref?.drugClasses.map(normalizeIngredient) ?? [])].filter((h) => h.length >= 4) };
  });

  meta.forEach((m, i) => {
    if (input.coverage.drugs && !m.ref) alerts.push({ key: `unlinked:${i}`, kind: "unlinked", severity: "warning", itemIndexes: [i], requiresOverride: false, message: `"${m.it.genericName}" is not linked to the drug reference, so it was checked by name only.` });
    if (m.ref?.highRisk) alerts.push({ key: `high_risk:${i}`, kind: "high_risk", severity: "high", itemIndexes: [i], requiresOverride: true, source: m.ref.sourceLabel, message: `High-risk medication: "${m.it.genericName}". Confirm the indication, dose and monitoring plan.` });
    if (m.ref?.pediatricCaution && patient.ageYears !== null && patient.ageYears < 12) alerts.push({ key: `pediatric:${i}`, kind: "pediatric", severity: "warning", itemIndexes: [i], requiresOverride: false, source: m.ref.sourceLabel, message: `Paediatric caution for "${m.it.genericName}": ${m.ref.pediatricCaution}` });
    if (m.ref?.pregnancyCaution) {
      if (patient.pregnant === true) alerts.push({ key: `pregnancy:${i}`, kind: "pregnancy", severity: "high", itemIndexes: [i], requiresOverride: true, source: m.ref.sourceLabel, message: `Patient is recorded as pregnant. Reference caution for "${m.it.genericName}": ${m.ref.pregnancyCaution}` });
      else if (patient.pregnant === null && patient.sex === "female" && patient.ageYears !== null && patient.ageYears >= 12 && patient.ageYears <= 55) alerts.push({ key: `pregnancy:${i}`, kind: "pregnancy", severity: "info", itemIndexes: [i], requiresOverride: false, source: m.ref.sourceLabel, message: `Pregnancy status is not recorded. Reference caution for "${m.it.genericName}": ${m.ref.pregnancyCaution}` });
    }
    for (const allergy of allergies) {
      const toks = tokens(allergy);
      if (toks.some((t) => m.hay.some((h) => h === t || h.includes(t) || t.includes(h)))) alerts.push({ key: `allergy:${i}:${normalizeIngredient(allergy)}`, kind: "allergy", severity: "high", itemIndexes: [i], requiresOverride: true, message: `Possible allergy match: patient allergy "${allergy}" and "${m.it.genericName}".` });
    }
  });

  const ix = new Map(input.interactions.map((x) => [pairKey(normalizeIngredient(x.a), normalizeIngredient(x.b)), x]));
  for (let i = 0; i < meta.length; i++) for (let j = i + 1; j < meta.length; j++) {
    const shared = meta[i].ingredients.filter((x) => meta[j].ingredients.includes(x));
    if (shared.length) alerts.push({ key: `duplicate_ingredient:${i}-${j}:${[...new Set(shared)].sort().join(",")}`, kind: "duplicate_ingredient", severity: "high", itemIndexes: [i, j], requiresOverride: true, message: `Duplicate active ingredient (${[...new Set(shared)].join(", ")}) in "${meta[i].it.genericName}" and "${meta[j].it.genericName}".` });
    for (const x of meta[i].ingredients) for (const y of meta[j].ingredients) {
      if (x === y) continue;
      const hit = ix.get(pairKey(x, y)); if (!hit) continue;
      const severity = IX_SEVERITY[hit.severity];
      alerts.push({ key: `interaction:${i}-${j}:${pairKey(x, y)}`, kind: "interaction", severity, itemIndexes: [i, j], requiresOverride: severity === "critical" || severity === "high", source: hit.sourceLabel, message: `${meta[i].it.genericName} + ${meta[j].it.genericName} (${hit.severity}): ${hit.description}` });
    }
  }

  const limits: string[] = [];
  if (!input.coverage.drugs) limits.push("No drug reference data is loaded: only name-based checks were possible.");
  if (!input.coverage.interactions) limits.push("No interaction data is loaded: interaction screening was NOT performed.");
  limits.push("Renal and hepatic dose adjustment is not screened.");

  alerts.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.key.localeCompare(b.key));
  return { alerts, limits };
}
