import { NextResponse } from "next/server";
import type { Actor } from "@/lib/security/rbac";
import { isSameOrigin } from "@/lib/security/origin";
import { getActor } from "@/server/auth/current-actor";
import { errorResponse } from "@/lib/http";

interface Args { req: Request; actor: Actor; params: Record<string, string>; body: unknown }
type Ctx = { params: Promise<Record<string, string>> };

/**
 * Standard wrapper for authenticated API routes: CSRF origin check on mutations, session required,
 * JSON body parsing, and safe error mapping. Authorization itself lives in the services.
 */
export function withActor(handler: (a: Args) => Promise<unknown>, opts: { status?: number } = {}) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    if (req.method !== "GET" && req.method !== "HEAD" && !isSameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: unknown = undefined;
    if (req.method !== "GET" && req.method !== "HEAD" && (req.headers.get("content-type") ?? "").includes("json")) {
      const raw = await req.text();
      if (raw.trim() !== "") { try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Malformed JSON" }, { status: 400 }); } }
    }
    try {
      const result = await handler({ req, actor, params: await ctx.params, body });
      return NextResponse.json(result ?? { ok: true }, { status: opts.status ?? 200 });
    } catch (e) { return errorResponse(e); }
  };
}
