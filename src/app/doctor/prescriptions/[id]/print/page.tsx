import { notFound, redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { prescriptionService } from "@/server/prescriptions";
import { NotFoundError, ValidationError } from "@/server/errors";
import { appOrigin, qrSvg, verifyUrl } from "@/server/prescriptions/qr";
import { PrescriptionSheet } from "@/components/PrescriptionSheet";
import type { Lang } from "@/lib/rx-labels";

export const metadata = { title: "Prescription — print" };

export default async function PrintPrescription({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lang?: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const { id } = await params; const sp = await searchParams;
  let data;
  try { data = await prescriptionService().printable(actor, id); } catch (e) { if (e instanceof NotFoundError) notFound(); if (e instanceof ValidationError) return <main className="p-8"><p>{e.message}. Finalize (sign) the prescription first.</p></main>; throw e; }
  const lang: Lang = sp.lang === "bn" || sp.lang === "en" ? sp.lang : data.content.language;
  const url = verifyUrl(await appOrigin(), data.code);
  return (
    <div className="bg-slate-100 py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 0 } @media print { .no-print { display: none !important } .rx-sheet { box-shadow: none !important } }`}</style>
      <nav className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-3 text-sm">
        <a className="underline" href={`/doctor/prescriptions/${id}`}>← Back</a>
        <a className="underline" href={`?lang=${lang === "bn" ? "en" : "bn"}`}>{lang === "bn" ? "English" : "বাংলা"}</a>
        <a className="underline" href={`/api/prescriptions/${id}/pdf?lang=${lang}`}>Download PDF</a>
        <span className="text-slate-600">Use your browser’s Print (Ctrl/Cmd+P) for a paper copy.</span>
      </nav>
      <div className="shadow"><PrescriptionSheet data={data} lang={lang} verifyUrl={url} qr={await qrSvg(url)} /></div>
    </div>
  );
}
