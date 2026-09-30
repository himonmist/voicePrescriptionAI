import { notFound, redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { consultationService } from "@/server/consultations";
import { NotFoundError } from "@/server/errors";
import { draftingService } from "@/server/ai";
import { ConsultationWorkspace } from "@/components/ConsultationWorkspace";

export default async function ConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const { id } = await params;
  let w;
  try { w = await consultationService().getWorkspace(actor, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  if (w.access !== "author") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10"><h1 className="text-2xl font-semibold">{w.patient.name}</h1>
        <p className="mt-2 text-sm text-slate-600">Shared with you read-only. Only the approved clinical note is visible.</p>
        {w.note ? <pre className="mt-4 whitespace-pre-wrap rounded border p-3 text-sm">{Object.entries(w.note.content.sections).filter(([, s]) => s.state === "documented").map(([k, s]) => `${k}: ${s.text}`).join("\n\n")}</pre> : <p className="mt-4">No approved note yet.</p>}
      </main>);
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <ConsultationWorkspace id={id} patientId={w.consultation.patientId} completed={w.consultation.status !== "in_progress"} patient={w.patient} consentRecording={w.consent.recording} aiAvailable={draftingService().available()}
        segments={w.segments!} note={w.note ? { status: w.note.status, currentVersion: w.note.currentVersion, content: w.note.content } : null} warnings={w.warnings ?? []} />
    </main>);
}
