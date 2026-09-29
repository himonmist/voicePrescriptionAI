export interface RateResult { allowed: boolean; remaining: number; retryAfterMs: number }

/** In-memory limiter (per instance). Production uses the DB-backed limiter in rate-limit-db.ts for cross-instance safety. */
export class MemoryRateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}
  hit(key: string, limit: number, windowMs: number): RateResult {
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => x > t - windowMs);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      return { allowed: false, remaining: 0, retryAfterMs: arr[0] + windowMs - t };
    }
    arr.push(t);
    this.hits.set(key, arr);
    return { allowed: true, remaining: limit - arr.length, retryAfterMs: 0 };
  }
}
