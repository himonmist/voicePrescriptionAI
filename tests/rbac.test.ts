import { describe, it, expect } from "vitest";
import { can, assertCan, ForbiddenError, type Actor } from "@/lib/security/rbac";

const actor = (roles: Actor["roles"], orgId: string | null = "org1"): Actor => ({ userId: "u1", roles, orgId });

describe("rbac", () => {
  it("doctor can write own clinical notes but not manage plans", () => {
    expect(can(actor(["doctor"]), "consultation:write")).toBe(true);
    expect(can(actor(["doctor"]), "plan:manage")).toBe(false);
  });
  it("super admin has NO default patient record access", () => {
    expect(can(actor(["super_admin"], null), "patient:read")).toBe(false);
    expect(can(actor(["super_admin"], null), "doctor:verify")).toBe(true);
  });
  it("finance/support/content roles are narrowly scoped", () => {
    expect(can(actor(["finance"], null), "payment:read")).toBe(true);
    expect(can(actor(["finance"], null), "patient:read")).toBe(false);
    expect(can(actor(["support"], null), "ticket:manage")).toBe(true);
    expect(can(actor(["content_manager"], null), "cms:write")).toBe(true);
    expect(can(actor(["content_manager"], null), "payment:read")).toBe(false);
  });
  it("receptionist can book but never sign prescriptions", () => {
    expect(can(actor(["receptionist"]), "appointment:write")).toBe(true);
    expect(can(actor(["receptionist"]), "prescription:sign")).toBe(false);
  });
  it("only doctors can sign prescriptions; AI/none cannot", () => {
    expect(can(actor(["doctor"]), "prescription:sign")).toBe(true);
    expect(can(actor([]), "prescription:sign")).toBe(false);
  });
  it("patient limited to own-scope permissions", () => {
    expect(can(actor(["patient"]), "prescription:read_own")).toBe(true);
    expect(can(actor(["patient"]), "patient:read")).toBe(false);
  });
  it("assertCan throws ForbiddenError", () => {
    expect(() => assertCan(actor(["patient"]), "cms:write")).toThrow(ForbiddenError);
  });
  it("union of multiple roles", () => {
    expect(can(actor(["support", "content_manager"], null), "cms:write")).toBe(true);
  });
});
