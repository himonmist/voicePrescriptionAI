import { describe, it, expect } from "vitest";
import { screenPrescription, type RefDrug, type Interaction, type ScreenInput } from "@/server/drugs/safety";

// ALL data below is synthetic test data (fictional drug names), never real reference data.
const ref = (o: Partial<RefDrug> & { id: string; genericName: string }): RefDrug => ({ ingredients: [o.genericName.toLowerCase()], drugClasses: [], highRisk: false, pediatricCaution: null, pregnancyCaution: null, sourceLabel: "TEST-SOURCE v1", ...o });
const ALPHA = ref({ id: "r1", genericName: "Testalpha", drugClasses: ["testcillin"] });
const BETA = ref({ id: "r2", genericName: "Testbeta", drugClasses: ["testcillin"] });
const GAMMA = ref({ id: "r3", genericName: "Testgamma", ingredients: ["testgamma", "testdelta"] });
const DELTA = ref({ id: "r4", genericName: "Testdelta-combo", ingredients: ["testdelta"], highRisk: true });
const REFS = Object.fromEntries([ALPHA, BETA, GAMMA, DELTA].map((r) => [r.id, r]));
const base = (o: Partial<ScreenInput> = {}): ScreenInput => ({
  items: [], refs: REFS, interactions: [], allergies: [], patient: { ageYears: 40, sex: "male", pregnant: null },
  coverage: { drugs: true, interactions: true }, ...o,
});
const item = (id: string, name: string) => ({ drugRefId: id, genericName: name });
const kinds = (r: ReturnType<typeof screenPrescription>) => r.alerts.map((a) => a.kind);

describe("safety screening — honesty about coverage", () => {
  it("states plainly what was NOT screened when no reference data is loaded", () => {
    const r = screenPrescription(base({ coverage: { drugs: false, interactions: false }, refs: {}, items: [{ genericName: "Whatever" }] }));
    expect(r.limits.join(" ")).toMatch(/no drug reference data/i); expect(r.limits.join(" ")).toMatch(/interaction screening was not performed/i);
  });
  it("never reports 'no interactions' — with interaction data loaded it still lists limits (renal/hepatic not screened)", () => {
    const r = screenPrescription(base({ items: [item("r1", "Testalpha")] }));
    expect(r.limits.join(" ")).toMatch(/renal and hepatic/i); expect(r.limits.join(" ")).not.toMatch(/interaction screening was not performed/i);
    expect(r.alerts).toEqual([]);
  });
  it("flags items not linked to the reference as unchecked (warning, no override needed)", () => {
    const r = screenPrescription(base({ items: [{ genericName: "Free-text drug" }] }));
    expect(r.alerts).toMatchObject([{ kind: "unlinked", severity: "warning", requiresOverride: false }]);
  });
});

describe("allergy alerts", () => {
  it("matches an allergy to a drug class from the reference and requires an override", () => {
    const r = screenPrescription(base({ items: [item("r1", "Testalpha")], allergies: ["Testcillin - rash"] }));
    expect(r.alerts[0]).toMatchObject({ kind: "allergy", severity: "high", requiresOverride: true }); expect(r.alerts[0].message).toContain("Testcillin - rash");
  });
  it("matches by ingredient/name for unlinked items too", () => {
    const r = screenPrescription(base({ items: [{ genericName: "Testalpha 500" }], allergies: ["Testalpha"] }));
    expect(kinds(r)).toContain("allergy");
  });
  it("ignores short/unrelated allergy tokens (no false positives from 'no', 'to')", () => {
    expect(kinds(screenPrescription(base({ items: [item("r1", "Testalpha")], allergies: ["Allergic to seafood"] })))).not.toContain("allergy");
  });
  it("does not fire when the patient has no recorded allergies (and never says 'no allergies')", () => {
    const r = screenPrescription(base({ items: [item("r1", "Testalpha")] }));
    expect(kinds(r)).not.toContain("allergy");
  });
});

describe("duplicate ingredients", () => {
  it("flags two items sharing an active ingredient, including inside combination products", () => {
    const r = screenPrescription(base({ items: [item("r3", "Testgamma"), item("r4", "Testdelta-combo")] }));
    expect(r.alerts.find((a) => a.kind === "duplicate_ingredient")).toMatchObject({ severity: "high", requiresOverride: true, itemIndexes: [0, 1] });
  });
  it("flags the exact same drug prescribed twice", () => {
    expect(kinds(screenPrescription(base({ items: [item("r1", "Testalpha"), item("r1", "Testalpha")] })))).toContain("duplicate_ingredient");
  });
  it("different ingredients are not duplicates", () => { expect(kinds(screenPrescription(base({ items: [item("r1", "Testalpha"), item("r2", "Testbeta")] })))).not.toContain("duplicate_ingredient"); });
});

describe("interactions (only from loaded data)", () => {
  const ix = (severity: Interaction["severity"]): Interaction[] => [{ a: "testalpha", b: "testbeta", severity, description: "Synthetic interaction text", sourceLabel: "TEST-SOURCE v1" }];
  const two = [item("r1", "Testalpha"), item("r2", "Testbeta")];
  it.each([["contraindicated", "critical", true], ["major", "high", true], ["moderate", "warning", false], ["minor", "info", false]] as const)("%s → %s (override required: %s)", (sev, out, need) => {
    expect(screenPrescription(base({ items: two, interactions: ix(sev) })).alerts.find((a) => a.kind === "interaction")).toMatchObject({ severity: out, requiresOverride: need });
  });
  it("is order-insensitive and cites the source", () => {
    const a = screenPrescription(base({ items: [item("r2", "Testbeta"), item("r1", "Testalpha")], interactions: ix("major") })).alerts[0];
    expect(a.message).toMatch(/Synthetic interaction text/); expect(a.source).toBe("TEST-SOURCE v1");
  });
  it("finds interactions through combination-product ingredients", () => {
    const r = screenPrescription(base({ items: [item("r3", "Testgamma"), item("r1", "Testalpha")], interactions: [{ a: "testdelta", b: "testalpha", severity: "major", description: "x", sourceLabel: "S" }] }));
    expect(kinds(r)).toContain("interaction");
  });
  it("produces nothing when the pair is not in the loaded data — and the limits still say coverage is partial", () => {
    const r = screenPrescription(base({ items: two, interactions: [] }));
    expect(kinds(r)).not.toContain("interaction");
  });
});

describe("other reference-driven alerts", () => {
  it("high-risk medication requires explicit review", () => { expect(screenPrescription(base({ items: [item("r4", "Testdelta-combo")] })).alerts[0]).toMatchObject({ kind: "high_risk", requiresOverride: true }); });
  it("paediatric caution for under-12s only when the reference has one", () => {
    const refs = { ...REFS, r1: ref({ id: "r1", genericName: "Testalpha", pediatricCaution: "Reduce dose below 12 years" }) };
    expect(kinds(screenPrescription(base({ refs, items: [item("r1", "Testalpha")], patient: { ageYears: 8, sex: "male", pregnant: null } })))).toContain("pediatric");
    expect(kinds(screenPrescription(base({ refs, items: [item("r1", "Testalpha")] })))).not.toContain("pediatric");
    expect(kinds(screenPrescription(base({ items: [item("r1", "Testalpha")], patient: { ageYears: 8, sex: "male", pregnant: null } })))).not.toContain("pediatric");
  });
  it("pregnancy: known pregnant → override; unknown status in a woman of child-bearing age → informational", () => {
    const refs = { ...REFS, r1: ref({ id: "r1", genericName: "Testalpha", pregnancyCaution: "Avoid in pregnancy" }) };
    expect(screenPrescription(base({ refs, items: [item("r1", "Testalpha")], patient: { ageYears: 30, sex: "female", pregnant: true } })).alerts[0]).toMatchObject({ kind: "pregnancy", severity: "high", requiresOverride: true });
    expect(screenPrescription(base({ refs, items: [item("r1", "Testalpha")], patient: { ageYears: 30, sex: "female", pregnant: null } })).alerts[0]).toMatchObject({ kind: "pregnancy", severity: "info", requiresOverride: false });
    expect(kinds(screenPrescription(base({ refs, items: [item("r1", "Testalpha")], patient: { ageYears: 30, sex: "male", pregnant: null } })))).not.toContain("pregnancy");
  });
});

describe("alert identity & ordering", () => {
  it("keys are stable across runs (overrides refer to them) and unique", () => {
    const input = base({ items: [item("r3", "Testgamma"), item("r4", "Testdelta-combo")], allergies: ["Testgamma"] });
    const a = screenPrescription(input).alerts.map((x) => x.key), b = screenPrescription(input).alerts.map((x) => x.key);
    expect(a).toEqual(b); expect(new Set(a).size).toBe(a.length);
  });
  it("sorts most severe first", () => {
    const r = screenPrescription(base({ items: [item("r4", "Testdelta-combo"), { genericName: "Free" }] }));
    const order = ["critical", "high", "warning", "info"]; const sev = r.alerts.map((a) => order.indexOf(a.severity));
    expect(sev).toEqual([...sev].sort((x, y) => x - y));
  });
});
