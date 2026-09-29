import { describe, it, expect } from "vitest";
import { parseContentInput, completenessIssues, emptyContent, canonicalJson, prefillFromNote } from "@/server/prescriptions/content";
import { ValidationError } from "@/server/errors";
import { emptyNote, parseNoteInput } from "@/server/consultations/note";

// Synthetic drug names only.
const FULL = { genericName: "Testalpha", strength: "500 mg", dosageForm: "tablet", route: "oral", dose: "1 tablet", frequency: "twice daily", duration: { value: 5, unit: "days" } };
const rx = (items: unknown[], more: object = {}) => parseContentInput({ items, ...more });

describe("prescription content", () => {
  it("empty content has no items and nothing pre-filled as a clinical decision", () => {
    const c = emptyContent(); expect(c.items).toEqual([]); expect(c.overrides).toEqual([]); expect(c.language).toBe("en");
  });
  it("accepts a fully specified item and normalizes optional fields to null", () => {
    const c = rx([FULL]); expect(c.items[0]).toMatchObject({ genericName: "Testalpha", brandName: null, timing: null, quantity: null, refills: null, unresolved: [] });
  });
  it("does NOT invent values: missing dose/frequency/duration stay null (never defaulted)", () => {
    const c = rx([{ genericName: "Testalpha" }]);
    expect(c.items[0]).toMatchObject({ strength: null, dosageForm: null, route: null, dose: null, frequency: null, duration: null });
  });
  it("draft may be incomplete, but completeness lists exactly what is missing per item", () => {
    const issues = completenessIssues(rx([FULL, { genericName: "Testbeta", strength: "10 mg" }]));
    expect(issues.join("|")).toMatch(/Item 2 \(Testbeta\).*dosage form/i); expect(issues.join("|")).toMatch(/Item 2.*dose/i); expect(issues.join("|")).toMatch(/Item 2.*frequency/i); expect(issues.join("|")).toMatch(/Item 2.*duration/i);
    expect(issues.join("|")).not.toMatch(/Item 1/);
  });
  it("a field flagged 'unresolved' blocks completion even if it has a value", () => {
    const c = rx([{ ...FULL, unresolved: ["dose"] }]);
    expect(completenessIssues(c).join("|")).toMatch(/Item 1.*dose.*needs confirmation/i);
  });
  it("only known field names may be flagged unresolved", () => { expect(() => rx([{ ...FULL, unresolved: ["nonsense"] }])).toThrow(ValidationError); });
  it("duration: positive integer + unit, or explicitly ongoing", () => {
    expect(rx([{ ...FULL, duration: { ongoing: true } }]).items[0].duration).toEqual({ ongoing: true });
    for (const bad of [{ value: 0, unit: "days" }, { value: 400, unit: "days" }, { value: 2.5, unit: "days" }, { value: 5, unit: "years" }, { value: 5 }, "5 days"]) expect(() => rx([{ ...FULL, duration: bad }])).toThrow(ValidationError);
  });
  it("requires something to prescribe", () => {
    expect(completenessIssues(rx([])).join("|")).toMatch(/nothing to prescribe/i);
    expect(completenessIssues(rx([], { advice: "Rest and fluids" }))).toEqual([]);
    expect(completenessIssues(rx([], { investigations: ["CBC"] }))).toEqual([]);
  });
  it("strips HTML, enforces limits, and rejects unknown top-level fields", () => {
    expect(rx([{ ...FULL, comments: "Take <b>with</b> food" }]).items[0].comments).toBe("Take with food");
    expect(() => rx(Array(31).fill(FULL))).toThrow(ValidationError);
    expect(() => rx([{ ...FULL, dose: "x".repeat(300) }])).toThrow(ValidationError);
    expect(() => parseContentInput({ items: [], sneaky: 1 })).toThrow(ValidationError);
  });
  it("overrides need an alert key and a reason of at least 10 characters", () => {
    expect(rx([FULL], { overrides: [{ alertKey: "allergy:0:x", reason: "Benefit outweighs risk; patient counselled" }] }).overrides).toHaveLength(1);
    expect(() => rx([FULL], { overrides: [{ alertKey: "allergy:0:x", reason: "ok" }] })).toThrow(ValidationError);
    expect(() => rx([FULL], { overrides: [{ alertKey: "", reason: "long enough reason" }] })).toThrow(ValidationError);
  });
  it("drugRefId must be a uuid or null", () => { expect(() => rx([{ ...FULL, drugRefId: "not-a-uuid" }])).toThrow(ValidationError); });
  it("diagnoses keep their provisional/confirmed status (a diagnosis is never auto-confirmed)", () => {
    const c = parseContentInput({ diagnoses: [{ text: "Viral fever", status: "provisional" }, { text: "Hypertension", status: "confirmed" }] });
    expect(c.diagnoses.map((d) => d.status)).toEqual(["provisional", "confirmed"]);
    expect(() => parseContentInput({ diagnoses: [{ text: "x", status: "suspected" }] })).toThrow(ValidationError);
  });
  it("canonical JSON is key-order independent (hash stability)", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
});

describe("prefill from the consultation note (factual carry-over only)", () => {
  it("copies chief complaint, history, vitals and diagnoses (with their status) — and the patient's recorded allergies", () => {
    const note = parseNoteInput({ sections: { chiefComplaint: { state: "documented", text: "Fever 3 days" }, hpi: { state: "documented", text: "Onset gradual" }, plan: { state: "documented", text: "Rest" } }, vitals: { tempC: 38.6 }, diagnoses: [{ text: "Viral fever", status: "provisional" }] });
    const c = prefillFromNote(note, ["Penicillin - rash"]);
    expect(c).toMatchObject({ chiefComplaint: "Fever 3 days", history: "Onset gradual", vitals: { tempC: 38.6 }, allergiesSnapshot: ["Penicillin - rash"] });
    expect(c.diagnoses).toEqual([{ text: "Viral fever", status: "provisional" }]);
    expect(c.items).toEqual([]); expect(c.advice).toBe(""); // the plan is NOT turned into drugs or advice
  });
  it("works with no note: nothing is invented", () => {
    const c = prefillFromNote(null, []); expect(c.chiefComplaint).toBeNull(); expect(c.diagnoses).toEqual([]); expect(c.allergiesSnapshot).toEqual([]);
    expect(prefillFromNote(emptyNote(), []).chiefComplaint).toBeNull();
  });
});
