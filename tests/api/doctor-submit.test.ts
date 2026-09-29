import { describe, it, expect, vi, beforeEach } from "vitest";

const submit = vi.fn(); const getActor = vi.fn(); const getDoc = vi.fn();
vi.mock("@/server/auth/current-actor", () => ({ getActor: () => getActor() }));
vi.mock("@/server/doctors", () => ({ verificationService: () => ({ submitForVerification: submit }), doctorForUser: (id: string) => getDoc(id) }));

import { POST } from "@/app/api/doctor/verification/submit/route";

const call = (headers: Record<string, string> = { origin: "https://app.test" }) => POST(new Request("https://app.test/api/doctor/verification/submit", { method: "POST", headers }));
beforeEach(() => { submit.mockReset(); getActor.mockReset(); getDoc.mockReset(); });

describe("POST /api/doctor/verification/submit", () => {
  it("401 without session; 403 for non-doctors", async () => {
    getActor.mockResolvedValue(null); expect((await call()).status).toBe(401);
    getActor.mockResolvedValue({ userId: "p", roles: ["patient"], orgId: null }); expect((await call()).status).toBe(403);
  });
  it("uses the caller's OWN doctor profile (cannot target another doctor)", async () => {
    getActor.mockResolvedValue({ userId: "u1", roles: ["doctor"], orgId: null });
    getDoc.mockResolvedValue({ id: "doc-of-u1" });
    submit.mockResolvedValue(undefined);
    expect((await call()).status).toBe(200);
    expect(submit).toHaveBeenCalledWith("doc-of-u1", expect.objectContaining({ userId: "u1" }));
    expect(getDoc).toHaveBeenCalledWith("u1");
  });
  it("404 when the doctor has no profile", async () => {
    getActor.mockResolvedValue({ userId: "u1", roles: ["doctor"], orgId: null }); getDoc.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });
});
