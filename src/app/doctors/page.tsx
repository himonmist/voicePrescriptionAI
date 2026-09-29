import Link from "next/link";
import { getDb } from "@/db/client";
import { listPublicDoctors } from "@/server/directory/queries";

export const metadata = { title: "Find a doctor — SmartDoctorAid" };

export default async function Directory({ searchParams }: { searchParams: Promise<{ q?: string; specialty?: string; mode?: string; page?: string }> }) {
  const sp = await searchParams;
  const mode = sp.mode === "online" || sp.mode === "in_person" ? sp.mode : undefined;
  const { rows, total } = await listPublicDoctors(getDb(), { q: sp.q, specialty: sp.specialty, mode, page: Number(sp.page) || 1 });
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-semibold">Find a verified doctor</h1>
      <p className="mt-1 text-sm text-slate-600">Only doctors whose registration has been verified and who chose a public profile are listed.</p>
      <form className="mt-6 grid gap-2 sm:grid-cols-[1fr_12rem_10rem_auto]" role="search">
        <label className="sr-only" htmlFor="q">Name or specialty</label><input id="q" name="q" defaultValue={sp.q} placeholder="Name or specialty" className="rounded border p-2" />
        <label className="sr-only" htmlFor="sp">Specialty</label><input id="sp" name="specialty" defaultValue={sp.specialty} placeholder="Exact specialty" className="rounded border p-2" />
        <label className="sr-only" htmlFor="m">Mode</label><select id="m" name="mode" defaultValue={mode ?? ""} className="rounded border p-2"><option value="">Any mode</option><option value="in_person">In person</option><option value="online">Online</option></select>
        <button className="rounded bg-[var(--brand)] px-4 py-2 font-medium text-white">Search</button>
      </form>
      {rows.length === 0 ? <p className="mt-10 text-slate-600">No doctors match your search.</p> : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">{rows.map((d) => (
          <li key={d.userId} className="rounded border p-4">
            <h2 className="font-medium"><Link className="underline" href={`/doctors/${d.userId}`}>{d.fullName}</Link></h2>
            <p className="text-sm text-slate-700">{d.specialty}</p>
            <p className="mt-1 text-xs text-slate-500">BMDC {d.bmdcNumber} · {d.consultationMode === "both" ? "In person & online" : d.consultationMode === "online" ? "Online" : "In person"}{d.consultationFeeBdt != null && ` · ৳${d.consultationFeeBdt}`}</p>
          </li>))}</ul>)}
      <p className="mt-6 text-sm text-slate-500">{total} doctor{total === 1 ? "" : "s"}</p>
    </main>
  );
}
