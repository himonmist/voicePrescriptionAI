import { NextResponse } from "next/server";
import { dbRateLimiter } from "@/lib/security/rate-limit-db";
import { errorResponse } from "@/lib/http";

const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";

/** Unauthenticated read endpoints: per-IP rate limit (anti-scraping), short CDN cache on success only. */
export function publicHandler(handler: (a: { req: Request; params: Record<string, string> }) => Promise<unknown>, opts: { cacheSeconds?: number } = {}) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    const rl = await dbRateLimiter.hit(`public:${clientIp(req)}`, 120, 60_000);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } });
    try {
      const res = NextResponse.json(await handler({ req, params: await ctx.params }));
      if (opts.cacheSeconds) res.headers.set("Cache-Control", `public, s-maxage=${opts.cacheSeconds}, stale-while-revalidate=${opts.cacheSeconds * 2}`);
      return res;
    } catch (e) { return errorResponse(e); }
  };
}
