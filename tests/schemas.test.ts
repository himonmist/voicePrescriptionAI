import { describe, it, expect } from "vitest";
import { registerDoctorSchema, loginSchema, registerPatientSchema } from "@/lib/validation/auth";

describe("auth input validation", () => {
  it("normalizes email and rejects bad BD phone", () => {
    const ok = loginSchema.safeParse({ email: " A@B.COM ", password: "x" });
    expect(ok.success && ok.data.email).toBe("a@b.com");
    const bad = registerPatientSchema.safeParse({ fullName: "A B", email: "a@b.com", phone: "123", password: "Correct-Horse-9!" });
    expect(bad.success).toBe(false);
  });
  it("accepts +8801 / 01 phones", () => {
    for (const phone of ["01712345678", "+8801712345678"]) {
      expect(registerPatientSchema.safeParse({ fullName: "A B", email: "a@b.com", phone, password: "Correct-Horse-9!" }).success).toBe(true);
    }
  });
  it("doctor registration requires BMDC number and specialty", () => {
    expect(registerDoctorSchema.safeParse({ fullName: "Dr X", email: "d@x.com", phone: "01712345678", password: "Correct-Horse-9!" }).success).toBe(false);
  });
});
