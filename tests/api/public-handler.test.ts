import { describe, it, expect, vi, beforeEach } from "vitest";
const hit = vi.fn();
vi.mock("@/lib/security/rate-limit-db", () => ({ dbRateLimiter: { hit: (...a: unknown[]) => hit(...a) } }));
import { publicHandler } from "@/lib/public-api";
import { ValidationError } from "@/server/errors";

const req = (ip = "1.2.3.4") => new Request("https://app.test/api/public/x", { headers: { "x-forwarded-for": ip } });
beforeEach(() => hit.mockReset());

describe("publicHandler", () => {
  it("rate limits per IP and returns 429 with Retry-After", async () => {
    hit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterMs: 4200 });
    const r = await publicHandler(async () => ({ ok: 1 }))(req(), { params: Promise.resolve({}) });
    expect(r.status).toBe(429); expect(r.headers.get("retry-after")).toBe("5");
    expect(hit).toHaveBeenCalledWith("public:1.2.3.4", expect.any(Number), expect.any(Number));
  });
  it("passes through results and maps domain errors", async () => {
    hit.mockResolvedValue({ allowed: true, remaining: 10, retryAfterMs: 0 });
    expect((await publicHandler(async () => ({ a: 1 }))(req(), { params: Promise.resolve({}) })).status).toBe(200);
    expect((await publicHandler(async () => { throw new ValidationError("bad"); })(req(), { params: Promise.resolve({}) })).status).toBe(422);
  });
  it("sets short public caching, never caches errors", async () => {
    hit.mockResolvedValue({ allowed: true, remaining: 10, retryAfterMs: 0 });
    const ok = await publicHandler(async () => ({}), { cacheSeconds: 30 })(req(), { params: Promise.resolve({}) });
    expect(ok.headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=60");
    const bad = await publicHandler(async () => { throw new ValidationError("x"); }, { cacheSeconds: 30 })(req(), { params: Promise.resolve({}) });
    expect(bad.headers.get("cache-control")).toBeNull();
  });
});
