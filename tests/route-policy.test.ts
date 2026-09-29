import { describe, it, expect } from "vitest";
import { decideAccess } from "@/lib/security/route-policy";

describe("route policy (deny by default)", () => {
  it("public paths are open", () => {
    for (const p of ["/", "/login", "/register/doctor", "/api/auth/login", "/pricing"]) expect(decideAccess(p, []).allow).toBe(true);
  });
  it("unauthenticated users are redirected from app areas", () => {
    expect(decideAccess("/doctor/dashboard", null)).toMatchObject({ allow: false, redirect: "/login" });
    expect(decideAccess("/admin", null)).toMatchObject({ allow: false, redirect: "/login" });
  });
  it("enforces role per area", () => {
    expect(decideAccess("/doctor/patients", ["doctor"]).allow).toBe(true);
    expect(decideAccess("/doctor/patients", ["patient"]).allow).toBe(false);
    expect(decideAccess("/admin/doctors", ["doctor"]).allow).toBe(false);
    expect(decideAccess("/admin/doctors", ["super_admin"]).allow).toBe(true);
    expect(decideAccess("/patient/prescriptions", ["patient"]).allow).toBe(true);
    expect(decideAccess("/admin/cms", ["content_manager"]).allow).toBe(true);
    expect(decideAccess("/admin/payments", ["finance"]).allow).toBe(true);
    expect(decideAccess("/admin/payments", ["content_manager"]).allow).toBe(false);
  });
  it("unknown protected-looking paths under /api/ are denied without a session", () => {
    expect(decideAccess("/api/patients", null).allow).toBe(false);
  });
});
