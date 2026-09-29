import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { patientService } from "@/server/patients";
import { ForbiddenError } from "@/lib/security/rbac";

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const q = ((await searchParams).q ?? "").trim();
  let results: Awaited<ReturnType<ReturnType<typeof patientService>["search"]>> = [];
  let denied = false;
  if (q.length >= 2) {
    try { results = await patientService().search(actor, q); } catch (e) { if (e instanceof ForbiddenError) denied = true; else throw e; }
  }
  if (denied) return <main className="p-8"><h1 className="text-xl font-semibold">Permission denied</h1><p className="mt-2">Patient records are available to verified, active doctors only.</p></main>;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Patients</h1><Link href="/doctor/patients/new" className="rounded bg-[var(--brand)] px-3 py-2 text-sm font-medium text-white">New patient</Link></div>
      <form className="mt-6 flex gap-2" role="search">
        <label className="sr-only" htmlFor="q">Search patients</label>
        <input id="q" name="q" defaultValue={q} placeholder="Name, phone, or patient ID (SDA-…)" className="w-full rounded border p-2" />
        <button className="rounded border px-4">Search</button>
      </form>
      {q.length < 2 ? <p className="mt-8 text-slate-600">Search by name, mobile number, or patient ID. You only see patients you are treating or that were shared with you.</p>
        : results.length === 0 ? <p className="mt-8 text-slate-600">No matching patients.</p>
        : <ul className="mt-6 divide-y rounded border">{results.map((p) => (
            <li key={p.id}><Link href={`/doctor/patients/${p.id}`} className="flex justify-between p-3 hover:bg-slate-50"><span>{p.fullName}<span className="ml-2 text-xs text-slate-500">{p.patientCode}</span></span><span className="text-sm text-slate-600">{p.sex} · DOB {p.dob}</span></Link></li>))}</ul>}
    </main>
  );
}
