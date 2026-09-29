import { describe, it, expect, beforeAll } from "vitest";
import { signSession, verifySession } from "@/lib/security/session";

beforeAll(() => { process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-32+"; });

describe("session tokens", () => {
  it("round-trips claims", async () => {
    const t = await signSession({ sub: "u1", roles: ["doctor"], orgId: "o1", sid: "s1" }, 60);
    const c = await verifySession(t);
    expect(c?.sub).toBe("u1");
    expect(c?.roles).toEqual(["doctor"]);
  });
  it("rejects tampered tokens", async () => {
    const t = await signSession({ sub: "u1", roles: ["doctor"], orgId: null, sid: "s1" }, 60);
    expect(await verifySession(t.slice(0, -2) + "xx")).toBeNull();
  });
  it("rejects expired tokens", async () => {
    const t = await signSession({ sub: "u1", roles: [], orgId: null, sid: "s1" }, -10);
    expect(await verifySession(t)).toBeNull();
  });
  it("refuses to sign with a weak secret", async () => {
    const old = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "short";
    await expect(signSession({ sub: "u", roles: [], orgId: null, sid: "s" }, 60)).rejects.toThrow();
    process.env.AUTH_SECRET = old;
  });
});
