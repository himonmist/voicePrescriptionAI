import { describe, it, expect, vi, beforeEach } from "vitest";
const getActor = vi.fn();
vi.mock("@/server/auth/current-actor", () => ({ getActor: () => getActor() }));
import { withActor } from "@/lib/api";
import { ForbiddenError } from "@/lib/security/rbac";
import { NotFoundError, ValidationError, ConflictError } from "@/server/errors";

const req = (method = "GET", headers: Record<string, string> = {}) => new Request("https://app.test/api/x", { method, headers });
const ctx = { params: Promise.resolve({ id: "abc" }) };
const actor = { userId: "u", roles: ["doctor"], orgId: null };
beforeEach(() => getActor.mockReset());

describe("withActor", () => {
  it("401 without session", async () => { getActor.mockResolvedValue(null); expect((await withActor(async () => ({}))(req(), ctx)).status).toBe(401); });
  it("blocks cross-site mutating requests but allows GET", async () => {
    getActor.mockResolvedValue(actor);
    const h = withActor(async () => ({ ok: 1 }));
    expect((await h(req("POST", { origin: "https://evil.test" }), ctx)).status).toBe(403);
    expect((await h(req("GET"), ctx)).status).toBe(200);
    expect((await h(req("POST", { origin: "https://app.test" }), ctx)).status).toBe(200);
  });
  it("passes actor, params, and parsed JSON body", async () => {
    getActor.mockResolvedValue(actor);
    const fn = vi.fn().mockResolvedValue({ done: true });
    await withActor(fn)(new Request("https://app.test/x", { method: "POST", headers: { origin: "https://app.test", "content-type": "application/json" }, body: '{"a":1}' }), ctx);
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ actor, params: { id: "abc" }, body: { a: 1 } }));
  });
  it("maps domain errors to safe statuses", async () => {
    getActor.mockResolvedValue(actor);
    const run = async (e: unknown) => withActor(async () => { throw e; })(req(), ctx);
    expect((await run(new ForbiddenError("patient:read"))).status).toBe(403);
    expect((await run(new NotFoundError())).status).toBe(404);
    expect((await run(new ValidationError("bad"))).status).toBe(422);
    const c = await run(new ConflictError("dup", [{ id: "1" }])); expect(c.status).toBe(409);
    expect((await c.json()).duplicates).toEqual([{ id: "1" }]);
    const plain = await run(new ConflictError("slot taken")); expect(plain.status).toBe(409);
    expect(await plain.json()).toEqual({ error: "slot taken" }); // no empty duplicates noise
  });
  it("hides internals on unexpected errors", async () => {
    getActor.mockResolvedValue(actor);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await withActor(async () => { throw new Error("password=hunter2 at db.internal"); })(req(), ctx);
    expect(r.status).toBe(500); expect(JSON.stringify(await r.json())).not.toMatch(/hunter2|db\.internal/);
    spy.mockRestore();
  });
  it("respects a custom success status and 400 on malformed JSON", async () => {
    getActor.mockResolvedValue(actor);
    expect((await withActor(async () => ({}), { status: 201 })(req(), ctx)).status).toBe(201);
    const bad = new Request("https://app.test/x", { method: "POST", headers: { origin: "https://app.test", "content-type": "application/json" }, body: "{nope" });
    expect((await withActor(async () => ({}))(bad, ctx)).status).toBe(400);
  });
});
