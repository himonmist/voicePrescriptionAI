import { notFound, redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { prescriptionService } from "@/server/prescriptions";
import { NotFoundError } from "@/server/errors";
import { PrescriptionEditor } from "@/components/PrescriptionEditor";

export default async function PrescriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const { id } = await params;
  let v;
  try { v = await prescriptionService().get(actor, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PrescriptionEditor key={`${v.version}-${v.prescription.status}`} id={id} code={v.prescription.code} status={v.prescription.status} version={v.version} content={v.content} issues={v.issues}
        screening={{ alerts: v.screening.alerts as never, limits: v.screening.limits, overridesNeeded: v.screening.overridesNeeded, description: v.screening.description }} />
    </main>
  );
}
