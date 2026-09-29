import { describe, it, expect } from "vitest";
import { emptyNote, parseNoteInput, vitalWarnings, documentedCount, SECTION_KEYS } from "@/server/consultations/note";
import { ValidationError } from "@/server/errors";

const doc = (text: string) => ({ state: "documented", text });

describe("clinical note structure", () => {
  it("an empty note marks EVERY section 'not documented' — nothing is assumed normal", () => {
    const n = emptyNote();
    for (const k of SECTION_KEYS) expect(n.sections[k]).toMatchObject({ state: "not_documented", text: "" });
    expect(n.vitals).toBeNull(); expect(n.diagnoses).toEqual([]); expect(documentedCount(n)).toBe(0);
  });
  it("includes the configurable sections from the spec", () => {
    expect([...SECTION_KEYS]).toEqual(["chiefComplaint", "hpi", "pastHistory", "medicationHistory", "allergies", "familyHistory", "socialHistory", "ros", "examination", "assessment", "differential", "plan", "investigations", "counseling", "followUp"]);
  });
  it("omitted sections default to not documented (missing ≠ negative)", () => {
    const n = parseNoteInput({ sections: { chiefComplaint: doc("Fever for 3 days") } });
    expect(n.sections.chiefComplaint.state).toBe("documented"); expect(n.sections.examination.state).toBe("not_documented");
  });
  it("a clinician-written negative is kept as documented text, distinct from not documented", () => {
    const n = parseNoteInput({ sections: { allergies: doc("No known drug allergies (confirmed with patient)") } });
    expect(n.sections.allergies).toMatchObject({ state: "documented", text: "No known drug allergies (confirmed with patient)" });
  });
  it("rejects 'documented' with empty text and 'not_documented' with text", () => {
    expect(() => parseNoteInput({ sections: { hpi: doc("   ") } })).toThrow(ValidationError);
    expect(() => parseNoteInput({ sections: { hpi: { state: "not_documented", text: "sneaky" } } })).toThrow(ValidationError);
  });
  it("rejects unknown sections and forces origin to manual (clients cannot claim AI provenance)", () => {
    expect(() => parseNoteInput({ sections: { secret: doc("x") } })).toThrow(ValidationError);
    const n = parseNoteInput({ sections: { hpi: { ...doc("x"), origin: "ai_draft" } } });
    expect(n.sections.hpi.origin).toBe("manual");
  });
  it("strips HTML and enforces length limits", () => {
    expect(parseNoteInput({ sections: { plan: doc("Rest <script>alert(1)</script>and fluids") } }).sections.plan.text).toBe("Rest alert(1)and fluids");
    expect(() => parseNoteInput({ sections: { plan: doc("x".repeat(6000)) } })).toThrow(ValidationError);
  });
  it("keeps transcript source references (traceability) but only uuids", () => {
    const id = "3f2b8c1e-0000-4000-8000-000000000001";
    expect(parseNoteInput({ sections: { hpi: { ...doc("x"), sources: [id] } } }).sections.hpi.sources).toEqual([id]);
    expect(() => parseNoteInput({ sections: { hpi: { ...doc("x"), sources: ["<b>"] } } })).toThrow(ValidationError);
  });
  it("vitals: accepts plausible values, rejects impossible ones, systolic must exceed diastolic", () => {
    expect(parseNoteInput({ vitals: { bpSystolic: 120, bpDiastolic: 80, pulse: 72, tempC: 37.2, spo2: 98, respRate: 16, weightKg: 70, heightCm: 172 } }).vitals?.pulse).toBe(72);
    for (const bad of [{ tempC: 500 }, { spo2: 120 }, { pulse: 0 }, { bpSystolic: 80, bpDiastolic: 90 }, { weightKg: -3 }, { pulse: "fast" }]) expect(() => parseNoteInput({ vitals: bad })).toThrow(ValidationError);
    expect(() => parseNoteInput({ vitals: { bogus: 1 } })).toThrow(ValidationError);
  });
  it("diagnoses distinguish provisional from doctor-confirmed", () => {
    const n = parseNoteInput({ diagnoses: [{ text: "Viral fever", status: "provisional" }, { text: "Hypertension", status: "confirmed" }] });
    expect(n.diagnoses.map((d) => d.status)).toEqual(["provisional", "confirmed"]);
    expect(() => parseNoteInput({ diagnoses: [{ text: "x", status: "suspected" }] })).toThrow(ValidationError);
    expect(() => parseNoteInput({ diagnoses: Array(25).fill({ text: "Dx", status: "provisional" }) })).toThrow(ValidationError);
  });
  it("documentedCount counts documented sections only", () => {
    expect(documentedCount(parseNoteInput({ sections: { hpi: doc("a"), plan: doc("b") } }))).toBe(2);
  });
});

describe("vital-sign review flags (decision support, never a diagnosis)", () => {
  it("flags out-of-range values with plain-text explanations", () => {
    const w = vitalWarnings({ tempC: 39.2, spo2: 90, pulse: 130, bpSystolic: 185, bpDiastolic: 125 });
    expect(w.join(" ")).toMatch(/temperature/i); expect(w.join(" ")).toMatch(/oxygen/i); expect(w.join(" ")).toMatch(/pulse/i); expect(w.join(" ")).toMatch(/blood pressure/i);
    for (const line of w) expect(line).toMatch(/^Review:/);
  });
  it("returns nothing for normal or missing vitals", () => {
    expect(vitalWarnings({ tempC: 36.8, spo2: 98, pulse: 72, bpSystolic: 118, bpDiastolic: 76 })).toEqual([]);
    expect(vitalWarnings(null)).toEqual([]); expect(vitalWarnings({})).toEqual([]);
  });
});
