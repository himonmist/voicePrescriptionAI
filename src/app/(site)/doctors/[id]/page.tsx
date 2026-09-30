import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPublicDoctor } from "@/server/directory/queries";
import { getActor } from "@/server/auth/current-actor";
import { BookingPicker } from "@/components/BookingPicker";

export default async function DoctorProfile({ params }: { params: Promise<{ id: string }> }) {
  const d = await getPublicDoctor(getDb(), (await params).id);
  if (!d) notFound();
  const actor = await getActor();
  const viewer = !actor ? null : actor.roles.includes("patient") ? "patient" : "other";
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-semibold">{d.fullName}</h1>
      <p className="text-slate-700">{d.specialty}</p>
      <p className="mt-1 text-sm text-slate-500">BMDC registration {d.bmdcNumber} · <span title="Registration checked by SmartDoctorAid administrators">verified</span></p>
      {d.bio && <p className="mt-4 whitespace-pre-line">{d.bio}</p>}
      <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-1 text-sm"><dt className="text-slate-500">Languages</dt><dd>{d.languages.length ? d.languages.join(", ") : "—"}</dd><dt className="text-slate-500">Chamber</dt><dd>{d.chamberAddress ?? "—"}</dd><dt className="text-slate-500">Fee</dt><dd>{d.consultationFeeBdt != null ? `৳${d.consultationFeeBdt}` : "—"}</dd></dl>
      <BookingPicker doctorId={d.userId} doctorMode={d.consultationMode} viewer={viewer} fee={d.consultationFeeBdt} />
    </main>
  );
}
