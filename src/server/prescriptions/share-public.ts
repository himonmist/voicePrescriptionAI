import { NextResponse } from "next/server";
import { dbRateLimiter } from "@/lib/security/rate-limit-db";
import { isSameOrigin } from "@/lib/security/origin";
import { errorResponse } from "@/lib/http";
import { ValidationError } from "@/server/errors";
import { shareService } from "./index";
import { ShareUnavailableError } from "./share";
import { appOrigin, qrPngBuffer, qrSvg, verifyUrl } from "./qr";
import { needsBrowserRendering, renderPrescriptionPdf } from "./pdf";
import type { PrescriptionContent } from "./content";

const ip = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" };
const json = (body: unknown, status: number, extra: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } });

/** Shared front door for the public share endpoints: same-origin, per-IP throttle, body {dob}, uniform errors, never cached. */
export async function sharedRx(req: Request, token: string, kind: "open" | "pdf"): Promise<Response> {
  if (!isSameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const rl = await dbRateLimiter.hit(`rxshare:${ip(req)}`, 20, 60_000);
  if (!rl.allowed) return json({ error: "Too many attempts. Please wait a minute." }, 429, { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) });
  try {
    let dob = ""; try { const b = await req.json(); dob = typeof b?.dob === "string" ? b.dob : ""; } catch { /* handled as mismatch */ }
    const r = await shareService().open(token, dob);
    if (!r.copy) return json({ state: r.state }, 200);
    const url = verifyUrl(await appOrigin(), r.copy.code);
    const data = r.copy as unknown as Parameters<typeof needsBrowserRendering>[0] & { content: PrescriptionContent };
    const lang = data.content.language;
    if (kind === "open") return json({ state: r.state, copy: r.copy, lang, verifyUrl: url, qr: await qrSvg(url), pdfAvailable: !needsBrowserRendering(data, lang) }, 200);
    if (needsBrowserRendering(data, lang)) return json({ error: "This prescription contains Bengali text; use your browser's Print → Save as PDF." }, 422);
    const bytes = await renderPrescriptionPdf({ data, lang, verifyUrl: url, qrPng: await qrPngBuffer(url) });
    return new NextResponse(Buffer.from(bytes), { headers: { ...NO_STORE, "content-type": "application/pdf", "content-disposition": `attachment; filename="${r.copy.code}.pdf"` } });
  } catch (e) {
    if (e instanceof ShareUnavailableError) return json({ error: e.message }, 410);
    if (e instanceof ValidationError) return json({ error: e.message }, 422);
    return errorResponse(e);
  }
}
