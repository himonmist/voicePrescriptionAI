import { z } from "zod";
import { isValidDate } from "@/lib/time";
import { ValidationError } from "@/server/errors";
import { vitalsSchema, type NoteContent, type Vitals } from "@/server/consultations/note";

/** Fields a doctor may flag as "needs confirmation". Any flag blocks approval. */
export const UNRESOLVABLE = ["genericName", "strength", "dosageForm", "route", "dose", "frequency", "timing", "duration", "quantity", "refills"] as const;
const REQUIRED: [keyof Item, string][] = [["strength", "strength"], ["dosageForm", "dosage form"], ["route", "route"], ["dose", "dose"], ["frequency", "frequency"], ["duration", "duration"]];

const strip = (s: string) => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const opt = (max: number) => z.string().max(max).transform(strip).nullish().transform((v) => (v ? v : null));

const durationSchema = z.union([z.object({ value: z.number().int().min(1).max(365), unit: z.enum(["days", "weeks", "months"]) }).strict(), z.object({ ongoing: z.literal(true) }).strict()]).nullish().transform((v) => v ?? null);
const itemSchema = z.object({
  drugRefId: z.uuid().nullish().transform((v) => v ?? null),
  genericName: z.string().max(200).transform(strip).pipe(z.string().min(1, "Drug name is required")),
  brandName: opt(200), strength: opt(100), dosageForm: opt(80), route: opt(60), dose: opt(100), frequency: opt(100), timing: opt(100),
  duration: durationSchema, quantity: opt(50), refills: z.number().int().min(0).max(12).nullish().transform((v) => v ?? null),
  warnings: opt(500), comments: opt(500), unresolved: z.array(z.enum(UNRESOLVABLE)).max(10).optional().default([]),
});
const diagnosisSchema = z.object({ text: z.string().min(2).max(200).transform(strip), status: z.enum(["provisional", "confirmed"]) });
const contentSchema = z.object({
  diagnoses: z.array(diagnosisSchema).max(20).optional().default([]),
  chiefComplaint: opt(1000), history: opt(2000), allergiesSnapshot: z.array(z.string().max(200).transform(strip)).max(50).optional().default([]),
  vitals: vitalsSchema.nullish().transform((v) => v ?? null),
  items: z.array(itemSchema).max(30).optional().default([]),
  investigations: z.array(z.string().min(1).max(200).transform(strip)).max(20).optional().default([]),
  advice: z.string().max(2000).transform(strip).optional().default(""),
  followUp: z.object({ date: z.string().refine(isValidDate, "Invalid follow-up date").nullish().transform((v) => v ?? null), text: opt(300) }).nullish().transform((v) => v ?? null),
  referral: z.object({ to: opt(200), reason: opt(500) }).nullish().transform((v) => v ?? null),
  language: z.enum(["en", "bn"]).optional().default("en"),
  overrides: z.array(z.object({ alertKey: z.string().min(1).max(300), reason: z.string().transform(strip).pipe(z.string().min(10, "An override needs a documented reason (min 10 characters)").max(500)) })).max(100).optional().default([]),
}).strict();

export type Item = z.output<typeof itemSchema>;
export type PrescriptionContent = z.output<typeof contentSchema>;
export type Duration = Item["duration"];

export const emptyContent = (): PrescriptionContent => contentSchema.parse({});

export function parseContentInput(raw: unknown): PrescriptionContent {
  const r = contentSchema.safeParse(raw ?? {});
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid prescription");
  return r.data;
}

/** What must be fixed before a doctor can approve. The system never fills a missing value. */
export function completenessIssues(c: PrescriptionContent): string[] {
  const issues: string[] = [];
  c.items.forEach((it, i) => {
    const label = `Item ${i + 1} (${it.genericName})`;
    for (const [k, human] of REQUIRED) if (it[k] === null || it[k] === undefined) issues.push(`${label}: missing ${human}`);
    for (const f of it.unresolved) issues.push(`${label}: ${f} needs confirmation`);
  });
  if (c.items.length === 0 && !c.advice && c.investigations.length === 0) issues.push("Nothing to prescribe: add a medication, an investigation or advice");
  return issues;
}

/** Factual carry-over only: the doctor's own documented text and statuses, plus the patient's recorded allergies. No drugs, doses or advice are suggested. */
export function prefillFromNote(note: NoteContent | null, allergies: string[]): PrescriptionContent {
  const doc = (k: "chiefComplaint" | "hpi") => (note?.sections[k].state === "documented" ? note.sections[k].text : null);
  return contentSchema.parse({ chiefComplaint: doc("chiefComplaint"), history: doc("hpi"), vitals: (note?.vitals as Vitals | null) ?? null, diagnoses: note?.diagnoses ?? [], allergiesSnapshot: allergies });
}

/** Stable serialization (sorted keys) so hashes do not depend on property order. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
