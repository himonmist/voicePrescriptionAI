import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { patientRxView } from "@/server/prescriptions";

export const metadata = { title: "My prescriptions — SmartDoctorAid" };
const LABEL: Record<string, string> = { finalized: "Valid", superseded: "Replaced by a newer version", cancelled: "Cancelled" };

export default async function MyPrescriptions() {
  const actor = await getActor(); if (!actor) redirect("/login");
  const rows = await patientRxView().list(actor);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">My prescriptions</h1>
      {rows.length === 0 ? <p className="mt-4 text-slate-600">No prescriptions yet. They appear here once your doctor signs them.</p> : (
        <ul className="mt-4 divide-y rounded border bg-white">{rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 p-3"><div><p className="font-medium">{r.code} · {r.doctorName}</p><p className="text-sm text-slate-600">{r.issuedAt?.toISOString().slice(0, 10)} · {LABEL[r.status] ?? r.status}</p></div><Link className="rounded border px-3 py-1 text-sm" href={`/patient/prescriptions/${r.id}`}>View</Link></li>))}</ul>)}
    </main>
  );
}
