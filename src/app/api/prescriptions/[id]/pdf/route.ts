import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/current-actor";
import { prescriptionService } from "@/server/prescriptions";
import { errorResponse } from "@/lib/http";
import { needsBrowserRendering, renderPrescriptionPdf } from "@/server/prescriptions/pdf";
import { appOrigin, qrPngBuffer, verifyUrl } from "@/server/prescriptions/qr";

export const runtime = "nodejs";

/** GET ?lang=en|bn — sealed prescription as PDF. Bengali content is refused (422): use the browser print page, which shapes Bengali correctly. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await ctx.params;
    const q = new URL(req.url).searchParams.get("lang");
    const data = await prescriptionService().printable(actor, id);
    const lang = q === "bn" || q === "en" ? q : data.content.language;
    if (needsBrowserRendering(data, lang)) return NextResponse.json({ error: "This prescription contains Bengali text, which cannot be exported to PDF reliably yet. Open the print view and choose “Save as PDF” in your browser." }, { status: 422 });
    const url = verifyUrl(await appOrigin(), data.code);
    const bytes = await renderPrescriptionPdf({ data, lang, verifyUrl: url, qrPng: await qrPngBuffer(url) });
    return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${data.code}.pdf"`, "cache-control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
