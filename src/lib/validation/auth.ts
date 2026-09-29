import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const bdPhone = z.string().trim().regex(/^(?:\+?88)?01[3-9]\d{8}$/, "Enter a valid Bangladesh mobile number");
const password = z.string().min(12).max(128);
const fullName = z.string().trim().min(2).max(120);

export const loginSchema = z.object({ email, password: z.string().min(1).max(128), totp: z.string().regex(/^\d{6}$/).optional(), recoveryCode: z.string().trim().regex(/^[a-z0-9]{5}-[a-z0-9]{5}$/i).optional() });

export const registerPatientSchema = z.object({ fullName, email, phone: bdPhone, password });

export const registerDoctorSchema = z.object({
  fullName, email, phone: bdPhone, password,
  bmdcNumber: z.string().trim().min(3).max(30),
  specialty: z.string().trim().min(2).max(80),
});

export type RegisterDoctorInput = z.infer<typeof registerDoctorSchema>;
