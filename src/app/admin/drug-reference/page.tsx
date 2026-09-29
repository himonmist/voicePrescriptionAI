import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { can } from "@/lib/security/rbac";
import { drugService } from "@/server/drugs";
import { DrugImportForm } from "@/components/DrugImportForm";

export default async function DrugReferenceAdmin() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!can(actor, "drugref:manage")) return <main className="p-8"><h1 className="text-xl font-semibold">Permission denied</h1></main>;
  const c = await drugService().coverage(actor);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Drug reference data</h1>
      <p className="mt-2 rounded border p-3 text-sm" role="status">{c.message}</p>
      <p className="mt-4 text-sm text-slate-700">SmartDoctorAid ships <strong>no</strong> drug data. Import only data you are licensed or authorized to use (for example a licensed national or commercial formulary). Every import records its source, version, publication date and licence note; the source is shown to doctors next to every alert.</p>
      <h2 className="mt-6 mb-2 font-medium">Import a source</h2>
      <DrugImportForm />
    </main>
  );
}
