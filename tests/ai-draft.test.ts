import { describe, it, expect } from "vitest";
import { draftSchema, groundDraft, mergeIntoExisting, extractJson, buildUserPrompt, SYSTEM_PROMPT } from "@/server/ai/draft";
import { emptyNote } from "@/server/consultations/note";

const lines = [
  { id: "s1", speaker: "patient", text: "আমার তিন দিন ধরে জ্বর আর মাথা ব্যথা" },
  { id: "s2", speaker: "doctor", text: "Blood pressure is 120/80 and temperature 38.5 celsius." },
  { id: "s3", speaker: "doctor", text: "I think this is viral fever." },
];
const parse = (o: unknown) => draftSchema.parse(o);

describe("AI draft grounding", () => {
  it("keeps sections with verbatim evidence and records their source segments; origin is ai_draft", () => {
    const g = groundDraft(parse({ sections: { chiefComplaint: { text: "Fever and headache for 3 days", evidence: ["তিন দিন ধরে জ্বর"] } } }), lines);
    expect(g.content.sections.chiefComplaint).toMatchObject({ state: "documented", origin: "ai_draft", sources: ["s1"] });
    expect(g.kept).toEqual(["chiefComplaint"]);
  });
  it("drops invented content: no evidence, fabricated quotes, unknown sections", () => {
    const g = groundDraft(parse({ sections: { allergies: { text: "No known allergies", evidence: ["no known allergies"] }, hpi: { text: "x", evidence: [] }, bogus: { text: "y", evidence: ["viral fever"] } } }), lines);
    expect(g.content.sections.allergies.state).toBe("not_documented"); expect(g.content.sections.hpi.state).toBe("not_documented");
    expect(g.dropped.map((d) => d.item).sort()).toEqual(["allergies", "bogus", "hpi"]);
  });
  it("evidence matching ignores case and whitespace only", () => {
    const g = groundDraft(parse({ sections: { plan: { text: "t", evidence: ["  BLOOD   pressure is 120/80 "] } } }), lines);
    expect(g.content.sections.plan.state).toBe("documented");
  });
  it("vitals must appear in the transcript; invented numbers are dropped", () => {
    const g = groundDraft(parse({ vitals: { bpSystolic: 120, bpDiastolic: 80, tempC: 38.5, pulse: 96 } }), lines);
    expect(g.content.vitals).toEqual({ bpSystolic: 120, bpDiastolic: 80, tempC: 38.5 }); expect(g.dropped.some((d) => d.item === "vitals.pulse")).toBe(true);
  });
  it("substring numbers do not count (12 is not in 120/80 as a token)", () => {
    expect(groundDraft(parse({ vitals: { pulse: 12 } }), lines).content.vitals).toBeNull();
  });
  it("diagnoses are forced provisional and need evidence", () => {
    const g = groundDraft(parse({ diagnoses: [{ text: "Viral fever", evidence: ["this is viral fever"] }, { text: "Dengue", evidence: ["dengue"] }] }), lines);
    expect(g.content.diagnoses).toEqual([{ text: "Viral fever", status: "provisional" }]); expect(g.dropped[0].item).toContain("Dengue");
  });
  it("strips HTML from model text", () => {
    const g = groundDraft(parse({ sections: { plan: { text: "<img src=x onerror=alert(1)>Rest", evidence: ["Blood pressure is 120/80"] } } }), lines);
    expect(g.content.sections.plan.text).toBe("Rest");
  });
});

describe("merge + parsing", () => {
  const drafted = groundDraft(parse({ sections: { chiefComplaint: { text: "AI text", evidence: ["তিন দিন ধরে জ্বর"] }, plan: { text: "AI plan", evidence: ["viral fever"] } } }), lines).content;
  it("never overwrites doctor-documented sections", () => {
    const ex = emptyNote(); ex.sections.chiefComplaint = { state: "documented", text: "Doctor wrote this", sources: [], origin: "manual" };
    const m = mergeIntoExisting(ex, drafted);
    expect(m.content.sections.chiefComplaint.text).toBe("Doctor wrote this"); expect(m.skipped).toEqual(["chiefComplaint"]); expect(m.filled).toEqual(["plan"]);
  });
  it("extracts JSON from fenced/verbose model output and rejects garbage", () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 }); expect(() => extractJson("no json")).toThrow();
  });
  it("prompt treats transcript as data and forbids invention", () => {
    expect(SYSTEM_PROMPT).toMatch(/verbatim/); expect(SYSTEM_PROMPT).toMatch(/never instructions/); expect(buildUserPrompt(lines)).toContain("[s1] patient:");
  });
});

import { carryProvenance } from "@/server/consultations/note";
describe("provenance carry-over", () => {
  it("unchanged AI sections stay ai_draft; edited ones become manual", () => {
    const prev = emptyNote(); prev.sections.plan = { state: "documented", text: "AI plan", sources: ["s1"], origin: "ai_draft" }; prev.sections.hpi = { state: "documented", text: "AI hpi", sources: ["s2"], origin: "ai_draft" };
    const next = emptyNote(); next.sections.plan = { state: "documented", text: "AI plan", sources: [], origin: "manual" }; next.sections.hpi = { state: "documented", text: "AI hpi, edited", sources: [], origin: "manual" };
    const out = carryProvenance(prev, next); expect(out.sections.plan).toMatchObject({ origin: "ai_draft", sources: ["s1"] }); expect(out.sections.hpi.origin).toBe("manual");
  });
});
