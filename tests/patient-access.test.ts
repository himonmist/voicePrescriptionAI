import { describe, it, expect } from "vitest";
import { accessLevel, isRelationshipActive, type PatientRef, type Relationship } from "@/server/patients/access";
import type { Actor } from "@/lib/security/rbac";

const patient = (o: Partial<PatientRef> = {}): PatientRef => ({ id: "p1", organizationId: "orgA", userId: null, status: "active", ...o });
const rel = (o: Partial<Relationship> = {}): Relationship => ({ doctorUserId: "d1", kind: "treating", expiresAt: null, revokedAt: null, ...o });
const A = (roles: Actor["roles"], userId = "u1", orgId: string | null = "orgA"): Actor => ({ userId, roles, orgId });
const now = new Date("2026-01-01T00:00:00Z");

describe("patient access levels (deny by default)", () => {
  it("treating doctor gets clinical access", () => expect(accessLevel(A(["doctor"], "d1"), patient(), [rel()], now)).toBe("clinical"));
  it("doctor in the SAME org without a relationship gets nothing", () => expect(accessLevel(A(["doctor"], "d2"), patient(), [rel()], now)).toBe("none"));
  it("shared doctor gets clinical access until expiry", () => {
    const r = rel({ doctorUserId: "d2", kind: "shared", expiresAt: new Date("2026-02-01") });
    expect(accessLevel(A(["doctor"], "d2", "orgB"), patient(), [r], now)).toBe("clinical");
    expect(accessLevel(A(["doctor"], "d2", "orgB"), patient(), [r], new Date("2026-03-01"))).toBe("none");
  });
  it("revoked relationship grants nothing", () => expect(accessLevel(A(["doctor"], "d1"), patient(), [rel({ revokedAt: new Date("2025-12-01") })], now)).toBe("none"));
  it("receptionist: demographics only, same org only", () => {
    expect(accessLevel(A(["receptionist"], "r1", "orgA"), patient(), [], now)).toBe("demographics");
    expect(accessLevel(A(["receptionist"], "r1", "orgB"), patient(), [], now)).toBe("none");
    expect(accessLevel(A(["receptionist"], "r1", null), patient({ organizationId: null }), [], now)).toBe("none");
  });
  it("patient sees only their own linked record", () => {
    expect(accessLevel(A(["patient"], "pu1", null), patient({ userId: "pu1" }), [], now)).toBe("self");
    expect(accessLevel(A(["patient"], "pu2", null), patient({ userId: "pu1" }), [], now)).toBe("none");
  });
  it("platform/finance/support/content roles never get patient access", () => {
    for (const r of ["super_admin", "org_admin", "support", "finance", "content_manager"] as const)
      expect(accessLevel(A([r], "x", "orgA"), patient(), [rel({ doctorUserId: "x" })], now)).toBe("none");
  });
  it("merged/archived patients are inaccessible", () => {
    expect(accessLevel(A(["doctor"], "d1"), patient({ status: "merged" }), [rel()], now)).toBe("none");
  });
  it("isRelationshipActive honours revocation and expiry", () => {
    expect(isRelationshipActive(rel(), now)).toBe(true);
    expect(isRelationshipActive(rel({ expiresAt: new Date("2025-01-01") }), now)).toBe(false);
  });
});
