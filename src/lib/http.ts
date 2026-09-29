import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/security/rbac";
import { TenantIsolationError } from "@/lib/security/tenant";

/** Maps domain errors to safe HTTP responses (no internals leaked). */
export function errorResponse(e: unknown) {
  if (e instanceof ForbiddenError || e instanceof TenantIsolationError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const msg = e instanceof Error ? e.message : "";
  if (/illegal transition|concurrently|concurrent/i.test(msg)) return NextResponse.json({ error: msg }, { status: 409 });
  if (/requires review notes|not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : 422 });
  console.error("unhandled api error", e instanceof Error ? e.name : "unknown");
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
