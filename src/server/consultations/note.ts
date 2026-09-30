import { z } from "zod";
import { ValidationError } from "@/server/errors";

export const SECTION_KEYS = ["chiefComplaint", "hpi", "pastHistory", "medicationHistory", "allergies", "familyHistory", "socialHistory", "ros", "examination", "assessment", "differential", "plan", "investigations", "counseling", "followUp"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const SECTION_LABELS: Record<SectionKey, string> = {
  chiefComplaint: "Chief complaint", hpi: "History of present illness", pastHistory: "Past medical history", medicationHistory: "Medication history", allergies: "Allergies",
  familyHistory: "Family history", socialHistory: "Social history", ros: "Review of systems", examination: "Physical examination", assessment: "Assessment",
  differential: "Differential diagnosis", plan: "Plan", investigations: "Investigations", counseling: "Counseling", followUp: "Follow-up",
};

export interface Section { state: "documented" | "not_documented"; text: string; sources: string[]; origin: "manual" | "ai_draft" }
export interface Vitals { bpSystolic?: number; bpDiastolic?: number; pulse?: number; respRate?: number; tempC?: number; spo2?: number; weightKg?: number; heightCm?: number }
export interface Diagnosis { text: string; status: "provisional" | "confirmed" }
export interface NoteContent { sections: Record<SectionKey, Section>; vitals: Vitals | null; diagnoses: Diagnosis[] }

const stripTags = (s: string) => s.replace(/<[^>]*>/g, "").trim();
const MAX_BYTES = 60_000;

const sectionSchema = z.object({
  state: z.enum(["documented", "not_documented"]),
  text: z.string().max(5000).transform(stripTags),
  sources: z.array(z.uuid()).max(50).optional(),
}).superRefine((s, ctx) => {
  if (s.state === "documented" && s.text === "") ctx.addIssue({ code: "custom", message: "A documented section needs text" });
  if (s.state === "not_documented" && s.text !== "") ctx.addIssue({ code: "custom", message: "A section marked not documented must have no text" });
});

const num = (min: number, max: number) => z.number().min(min).max(max).optional();
export const vitalsSchema = z.object({
  bpSystolic: num(40, 300), bpDiastolic: num(20, 200), pulse: num(20, 300), respRate: num(4, 80),
  tempC: num(30, 45), spo2: num(50, 100), weightKg: num(0.3, 500), heightCm: num(20, 260),
}).strict().refine((v) => v.bpSystolic === undefined || v.bpDiastolic === undefined || v.bpSystolic > v.bpDiastolic, "Systolic pressure must be higher than diastolic");

const diagnosisSchema = z.object({ text: z.string().min(2).max(200).transform(stripTags), status: z.enum(["provisional", "confirmed"]) });

const inputSchema = z.object({
  sections: z.object(Object.fromEntries(SECTION_KEYS.map((k) => [k, sectionSchema.optional()])) as Record<SectionKey, z.ZodOptional<typeof sectionSchema>>).strict().optional(),
  vitals: vitalsSchema.nullable().optional(),
  diagnoses: z.array(diagnosisSchema).max(20).optional(),
});

export function emptyNote(): NoteContent {
  return { sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, { state: "not_documented", text: "", sources: [], origin: "manual" }])) as unknown as Record<SectionKey, Section>, vitals: null, diagnoses: [] };
}

/**
 * Validates and normalizes client input. Sections that are omitted become "not documented" — never
 * "normal". Provenance is forced to "manual": only server-side AI drafting (M8) may set another origin.
 */
export function parseNoteInput(raw: unknown): NoteContent {
  const r = inputSchema.safeParse(raw ?? {});
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid note");
  const out = emptyNote();
  for (const k of SECTION_KEYS) {
    const s = r.data.sections?.[k];
    if (s) out.sections[k] = { state: s.state, text: s.text, sources: s.sources ?? [], origin: "manual" };
  }
  out.vitals = r.data.vitals && Object.keys(r.data.vitals).length ? r.data.vitals : null;
  out.diagnoses = r.data.diagnoses ?? [];
  if (JSON.stringify(out).length > MAX_BYTES) throw new ValidationError("Note is too large");
  return out;
}

export const documentedCount = (n: NoteContent) => SECTION_KEYS.filter((k) => n.sections[k].state === "documented").length;

/** Range flags for clinician review. Purely informational: they never diagnose or block saving. */
export function vitalWarnings(v: Vitals | null): string[] {
  if (!v) return [];
  const w: string[] = [];
  if (v.tempC !== undefined && (v.tempC >= 38 || v.tempC < 35.5)) w.push(`Review: temperature ${v.tempC} °C is outside 35.5–37.9 °C`);
  if (v.spo2 !== undefined && v.spo2 < 94) w.push(`Review: oxygen saturation ${v.spo2}% is below 94%`);
  if (v.pulse !== undefined && (v.pulse > 120 || v.pulse < 50)) w.push(`Review: pulse ${v.pulse}/min is outside 50–120`);
  if ((v.bpSystolic !== undefined && (v.bpSystolic >= 180 || v.bpSystolic < 90)) || (v.bpDiastolic !== undefined && v.bpDiastolic >= 120)) w.push(`Review: blood pressure ${v.bpSystolic ?? "?"}/${v.bpDiastolic ?? "?"} mmHg is markedly abnormal`);
  if (v.respRate !== undefined && (v.respRate > 24 || v.respRate < 10)) w.push(`Review: respiratory rate ${v.respRate}/min is outside 10–24`);
  return w;
}

/**
 * A client always submits the whole note as "manual". If a section is byte-identical to an AI-drafted one from the previous
 * version, it is still AI-drafted (the doctor has not rewritten it); any edit makes it the doctor's own text.
 */
export function carryProvenance(prev: NoteContent | null | undefined, next: NoteContent): NoteContent {
  if (!prev) return next;
  for (const k of SECTION_KEYS) {
    const p = prev.sections[k], n = next.sections[k];
    if (p.origin === "ai_draft" && n.state === "documented" && p.state === "documented" && p.text === n.text) next.sections[k] = { ...n, origin: "ai_draft", sources: p.sources };
  }
  return next;
}
