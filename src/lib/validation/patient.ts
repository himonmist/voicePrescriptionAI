import { z } from "zod";
import { normalizePhone } from "@/lib/security/pii";

const phone = z.string().trim().transform((v, ctx) => { const n = normalizePhone(v); if (!n) ctx.addIssue({ code: "custom", message: "Invalid Bangladesh mobile number" }); return n as string; });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => { const d = new Date(s + "T00:00:00Z"); return !isNaN(+d) && d.toISOString().startsWith(s); }, "Invalid date")
  .refine((s) => s >= "1900-01-01" && new Date(s) <= new Date(), "Date of birth must be in the past");

export const createPatientSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  dob: isoDate,
  sex: z.enum(["male", "female", "other", "unknown"]),
  phone: phone.optional(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)).optional(),
  address: z.string().trim().max(300).optional(),
  emergencyContact: z.object({ name: z.string().trim().min(2).max(120), phone, relation: z.string().trim().max(60).optional() }).optional(),
});
export type CreatePatientInput = z.infer<typeof createPatientSchema>;

export const CONSENT_KINDS = ["treatment", "recording", "ai_processing", "data_sharing", "sms", "email", "whatsapp"] as const;
export const consentSchema = z.object({
  kind: z.enum(CONSENT_KINDS), granted: z.boolean(), method: z.enum(["in_person", "verbal", "digital"]), note: z.string().trim().max(500).optional(),
});

export const CLINICAL_KINDS = ["allergy", "condition", "medication", "immunization", "family_history", "procedure"] as const;
export const clinicalItemSchema = z.object({
  kind: z.enum(CLINICAL_KINDS), description: z.string().trim().min(2).max(1000), severity: z.enum(["mild", "moderate", "severe"]).optional(),
});

export const shareSchema = z.object({
  doctorUserId: z.uuid().or(z.string().min(1)), reason: z.string().trim().min(5).max(500), expiresInDays: z.number().int().min(1).max(90),
});
