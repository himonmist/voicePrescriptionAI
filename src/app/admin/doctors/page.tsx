import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { can } from "@/lib/security/rbac";
import { getDb } from "@/db/client";
import { listDoctorsForReview } from "@/server/doctors/queries";
import { DecisionButtons } from "@/components/DecisionButtons";

const FILTERS = ["verification_pending", "under_review", "approved", "active", "rejected", "suspended", "registered"];

export default async function AdminDoctors({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!can(actor, "doctor:verify")) return <main className="p-8"><h1 className="text-xl font-semibold">Permission denied</h1><p>You do not have access to doctor verification.</p></main>;
  const sp = await searchParams;
  const status = FILTERS.includes(sp.status ?? "") ? sp.status! : "verification_pending";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await listDoctorsForReview(getDb(), { statuses: [status], limit: 25, offset: (page - 1) * 25 });
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Doctor verification</h1>
      <nav aria-label="Status filter" className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => <a key={f} href={`?status=${f}`} aria-current={f === status ? "page" : undefined} className={`rounded border px-2 py-1 text-sm ${f === status ? "bg-slate-900 text-white" : ""}`}>{f.replace("_", " ")}</a>)}
      </nav>
      {rows.length === 0 ? <p className="mt-8 text-slate-600">No doctors with status “{status.replace("_", " ")}”.</p> : (
        <table className="mt-6 w-full text-left text-sm">
          <thead><tr><th className="py-2">Name</th><th>BMDC</th><th>Specialty</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.id} className="border-t">
              <td className="py-2">{d.fullName}{d.isTestAccount && <span className="ml-2 rounded bg-amber-100 px-1 text-xs">TEST</span>}<div className="text-xs text-slate-500">{d.email}</div></td>
              <td>{d.bmdcNumber}</td><td>{d.specialty}</td><td>{d.status.replace("_", " ")}</td>
              <td><DecisionButtons id={d.id} status={d.status} /></td>
            </tr>))}
          </tbody>
        </table>)}
      <p className="mt-4 text-sm text-slate-600">{total} total · page {page}{page > 1 && <> · <a className="underline" href={`?status=${status}&page=${page - 1}`}>prev</a></>}{page * 25 < total && <> · <a className="underline" href={`?status=${status}&page=${page + 1}`}>next</a></>}</p>
    </main>
  );
}
