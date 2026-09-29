import { describe, it, expect, vi, beforeEach } from "vitest";

const decide = vi.fn();
const getActor = vi.fn();
vi.mock("@/server/auth/current-actor", () => ({ getActor: () => getActor() }));
vi.mock("@/server/doctors", () => ({ verificationService: () => ({ decide, submitForVerification: vi.fn() }) }));

import { POST } from "@/app/api/admin/doctors/[id]/decision/route";
import { ForbiddenError } from "@/lib/security/rbac";

const ID = "3f2b8c1e-0000-4000-8000-000000000001";
const call = (body: unknown, headers: Record<string, string> = { origin: "https://app.test" }) =>
  POST(new Request("https://app.test/api/admin/doctors/x/decision", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) });

beforeEach(() => { decide.mockReset(); getActor.mockReset(); });

describe("POST /api/admin/doctors/[id]/decision", () => {
  it("401 without a session", async () => {
    getActor.mockResolvedValue(null);
    expect((await call({ to: "approved" })).status).toBe(401);
    expect(decide).not.toHaveBeenCalled();
  });
  it("403 for cross-site requests (CSRF)", async () => {
    getActor.mockResolvedValue({ userId: "a", roles: ["super_admin"], orgId: null });
    expect((await call({ to: "approved" }, { origin: "https://evil.test" })).status).toBe(403);
  });
  it("403 when the service denies the role", async () => {
    getActor.mockResolvedValue({ userId: "d", roles: ["doctor"], orgId: null });
    decide.mockRejectedValue(new ForbiddenError("doctor:verify"));
    expect((await call({ to: "approved" })).status).toBe(403);
  });
  it("422 for invalid target status or non-uuid id", async () => {
    getActor.mockResolvedValue({ userId: "a", roles: ["super_admin"], orgId: null });
    expect((await call({ to: "hacked" })).status).toBe(422);
  });
  it("409 for illegal transitions / concurrent change", async () => {
    getActor.mockResolvedValue({ userId: "a", roles: ["super_admin"], orgId: null });
    decide.mockRejectedValue(new Error("Illegal transition registered -> approved"));
    expect((await call({ to: "approved" })).status).toBe(409);
  });
  it("200 on success and passes actor + notes through", async () => {
    const actor = { userId: "a", roles: ["super_admin"], orgId: null };
    getActor.mockResolvedValue(actor);
    decide.mockResolvedValue(undefined);
    const r = await call({ to: "rejected", notes: "BMDC not found" });
    expect(r.status).toBe(200);
    expect(decide).toHaveBeenCalledWith(ID, "rejected", actor, "BMDC not found");
  });
});
