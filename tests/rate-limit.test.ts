import { describe, it, expect } from "vitest";
import { MemoryRateLimiter } from "@/lib/security/rate-limit";

describe("rate limiter", () => {
  it("blocks after limit within window and recovers", () => {
    let now = 0;
    const rl = new MemoryRateLimiter(() => now);
    for (let i = 0; i < 3; i++) expect(rl.hit("k", 3, 1000).allowed).toBe(true);
    const r = rl.hit("k", 3, 1000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
    now = 1001;
    expect(rl.hit("k", 3, 1000).allowed).toBe(true);
  });
  it("isolates keys", () => {
    const rl = new MemoryRateLimiter(() => 0);
    rl.hit("a", 1, 1000);
    expect(rl.hit("b", 1, 1000).allowed).toBe(true);
  });
});
