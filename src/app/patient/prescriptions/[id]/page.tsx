import { notFound, redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { patientRxView } from "@/server/prescriptions";
import { NotFoundError } from "@/server/errors";
import { appOrigin, qrSvg, verifyUrl } from "@/server/prescriptions/qr";
import { PrescriptionSheet } from "@/components/PrescriptionSheet";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Prescription — SmartDoctorAid" };

export default async function PatientPrescription({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(); if (!actor) redirect("/login");
  let data;
  try { data = await patientRxView().get(actor, (await params).id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const url = verifyUrl(await appOrigin(), data.code);
  return (
    <div className="bg-slate-100 py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 0 } @media print { .no-print { display: none !important } .rx-sheet { box-shadow: none !important } }`}</style>
      <nav className="no-print mx-auto mb-4 flex max-w-[210mm] items-center gap-3 px-2 text-sm"><a className="underline" href="/patient/prescriptions">← Back</a><PrintButton /></nav>
      <div className="shadow"><PrescriptionSheet data={data as never} lang={(data.content as { language: "en" | "bn" }).language} verifyUrl={url} qr={await qrSvg(url)} /></div>
    </div>
  );
}
