import { describe, it, expect } from "vitest";
import { parseDrugImport } from "@/server/drugs/import";
import { ValidationError } from "@/server/errors";

const SOURCE = { name: "TEST-SOURCE", version: "v1", publishedAt: "2026-01-15", licenceNote: "Synthetic test data, no licence needed" };
const DRUG = { genericName: "Testalpha", strength: "500 mg", dosageForm: "tablet" };

describe("drug reference import validation", () => {
  it("requires source name, version, publication date and an authorization/licence note", () => {
    for (const bad of [{ ...SOURCE, name: "" }, { ...SOURCE, version: "" }, { ...SOURCE, publishedAt: "yesterday" }, { ...SOURCE, licenceNote: "ok" }]) expect(() => parseDrugImport({ source: bad, drugs: [DRUG] })).toThrow(ValidationError);
  });
  it("normalizes ingredients/brands (lowercase, trimmed, de-duplicated) and defaults ingredients to the generic name", () => {
    const r = parseDrugImport({ source: SOURCE, drugs: [{ ...DRUG, genericName: "  TestAlpha ", brandNames: ["Brand  One", "brand one"], ingredients: [" TESTALPHA ", "testalpha", "Testdelta"] }, { ...DRUG, genericName: "Solo" }] });
    expect(r.drugs[0].ingredients).toEqual(["testalpha", "testdelta"]); expect(r.drugs[0].brandNames).toEqual(["Brand One"]);
    expect(r.drugs[1].ingredients).toEqual(["solo"]);
  });
  it("builds a lowercase search text from generic, brands and ingredients", () => {
    expect(parseDrugImport({ source: SOURCE, drugs: [{ ...DRUG, brandNames: ["Zedol"] }] }).drugs[0].searchText).toMatch(/testalpha.*zedol/);
  });
  it("rejects drugs missing generic name, strength or dosage form, and obvious junk", () => {
    for (const bad of [{ strength: "1 mg", dosageForm: "x" }, { genericName: "A", dosageForm: "x" }, { genericName: "A", strength: "1 mg" }, { ...DRUG, genericName: "x".repeat(300) }]) expect(() => parseDrugImport({ source: SOURCE, drugs: [bad] })).toThrow(ValidationError);
  });
  it("strips HTML from every free-text field", () => {
    expect(parseDrugImport({ source: SOURCE, drugs: [{ ...DRUG, warnings: "Take <b>care</b><script>x</script>" }] }).drugs[0].warnings).toBe("Take carex");
  });
  it("orders interaction ingredient pairs canonically (a<b) so lookups are order-insensitive; rejects self-pairs and unknown severities", () => {
    const r = parseDrugImport({ source: SOURCE, drugs: [DRUG], interactions: [{ ingredientA: "Zed", ingredientB: "alpha", severity: "major", description: "d" }] });
    expect(r.interactions[0]).toMatchObject({ ingredientA: "alpha", ingredientB: "zed" });
    expect(() => parseDrugImport({ source: SOURCE, drugs: [DRUG], interactions: [{ ingredientA: "a", ingredientB: "A", severity: "major", description: "d" }] })).toThrow(ValidationError);
    expect(() => parseDrugImport({ source: SOURCE, drugs: [DRUG], interactions: [{ ingredientA: "a", ingredientB: "b", severity: "scary", description: "d" }] })).toThrow(ValidationError);
  });
  it("de-duplicates repeated interaction pairs keeping the most severe", () => {
    const r = parseDrugImport({ source: SOURCE, drugs: [DRUG], interactions: [{ ingredientA: "a", ingredientB: "b", severity: "minor", description: "m" }, { ingredientA: "B", ingredientB: "A", severity: "major", description: "M" }] });
    expect(r.interactions).toHaveLength(1); expect(r.interactions[0].severity).toBe("major");
  });
  it("enforces size limits and requires at least one drug", () => {
    expect(() => parseDrugImport({ source: SOURCE, drugs: [] })).toThrow(ValidationError);
    expect(() => parseDrugImport({ source: SOURCE, drugs: Array(5001).fill(DRUG) })).toThrow(ValidationError);
  });
});
