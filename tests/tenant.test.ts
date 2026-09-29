import { describe, it, expect } from "vitest";
import { assertSameTenant, TenantIsolationError } from "@/lib/security/tenant";

describe("tenant isolation", () => {
  it("allows same org", () => {
    expect(() => assertSameTenant({ userId: "u", roles: ["doctor"], orgId: "a" }, "a")).not.toThrow();
  });
  it("blocks cross-org access", () => {
    expect(() => assertSameTenant({ userId: "u", roles: ["doctor"], orgId: "a" }, "b")).toThrow(TenantIsolationError);
  });
  it("blocks actor without org from org-owned resources", () => {
    expect(() => assertSameTenant({ userId: "u", roles: ["doctor"], orgId: null }, "b")).toThrow(TenantIsolationError);
  });
});
