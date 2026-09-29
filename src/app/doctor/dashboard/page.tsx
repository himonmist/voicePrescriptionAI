import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { doctorForUser } from "@/server/doctors";
import { SubmitVerification } from "@/components/SubmitVerification";

const COPY: Record<string, string> = {
  registered: "Your account is registered but not yet submitted for verification.",
  verification_pending: "Submitted. Waiting for a reviewer to pick this up.",
  under_review: "Your credentials are under review.",
  approved: "Approved. An administrator will activate your account shortly.",
  active: "Verified and active.",
  rejected: "Verification was not successful. See the note below and resubmit.",
  suspended: "Your account is suspended. Contact support.",
};

export default async function DoctorDashboard() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!actor.roles.includes("doctor")) return <main className="p-8"><h1 className="text-xl font-semibold">Permission denied</h1></main>;
  const doc = await doctorForUser(actor.userId);
  if (!doc) return <main className="p-8"><p>No doctor profile found.</p></main>;
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Doctor dashboard</h1>
      <section className="mt-6 rounded border p-4" aria-labelledby="ver">
        <h2 id="ver" className="font-medium">Verification status: <span className="rounded bg-slate-100 px-2 py-0.5">{doc.status.replace("_", " ")}</span></h2>
        <p className="mt-2 text-slate-700">{COPY[doc.status]}</p>
        {doc.status === "rejected" && doc.reviewNotes && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-900">Reviewer note: {doc.reviewNotes}</p>}
        {(doc.status === "registered" || doc.status === "rejected") && <div className="mt-4"><SubmitVerification /></div>}
        {doc.status !== "active" && <p className="mt-4 text-sm text-slate-600">Clinical features stay locked until your account is verified and active.</p>}
        {doc.status === "active" && <p className="mt-4"><a href="/doctor/patients" className="rounded bg-[var(--brand)] px-4 py-2 font-medium text-white">Patients</a></p>}
      </section>
    </main>
  );
}
