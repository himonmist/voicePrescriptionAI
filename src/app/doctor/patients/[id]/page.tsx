import { notFound, redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { patientService } from "@/server/patients";
import { NotFoundError } from "@/server/errors";
import { AddClinicalItem, ConsentPanel, ResolveItem } from "@/components/PatientActions";
import { StartConsultation } from "@/components/StartConsultation";

const KIND_LABEL: Record<string, string> = { allergy: "Allergies", condition: "Conditions", medication: "Current medications", immunization: "Immunizations", family_history: "Family history", procedure: "Procedures" };

export default async function PatientRecord({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const { id } = await params;
  let view;
  try { view = await patientService().getPatient(actor, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const p = view.patient;
  const items = view.clinical?.items.filter((i) => i.status === "active") ?? [];
  const grouped = Object.entries(KIND_LABEL).map(([k, label]) => ({ k, label, rows: items.filter((i) => i.kind === k) }));
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{p.fullName}</h1>
      <p className="text-sm text-slate-600">{p.patientCode} · {p.sex} · DOB {p.dob}</p>
      {view.level === "clinical" && <p className="mt-3"><StartConsultation patientId={id} label="Start walk-in consultation" /></p>}
      <section aria-labelledby="demo" className="mt-6"><h2 id="demo" className="font-medium">Contact</h2>
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-1 text-sm"><dt className="text-slate-500">Mobile</dt><dd>{p.phone ?? "—"}</dd><dt className="text-slate-500">Email</dt><dd>{p.email ?? "—"}</dd><dt className="text-slate-500">Address</dt><dd>{p.address ?? "—"}</dd><dt className="text-slate-500">Emergency</dt><dd>{p.emergencyContact ? `${p.emergencyContact.name} (${p.emergencyContact.relation ?? "contact"}) ${p.emergencyContact.phone}` : "—"}</dd></dl>
      </section>
      {view.level === "demographics" && <p className="mt-6 rounded bg-slate-100 p-3 text-sm">Clinical information is not available to your role.</p>}
      {view.clinical && (<>
        <section aria-labelledby="clin" className="mt-8"><h2 id="clin" className="font-medium">Clinical history</h2>
          {grouped.map((g) => (<div key={g.k} className="mt-3"><h3 className="text-sm font-medium text-slate-700">{g.label}</h3>
            {g.rows.length === 0 ? <p className="text-sm text-slate-500">{g.k === "allergy" ? "No allergies recorded (not the same as “no known allergies” — confirm with the patient)." : "None recorded."}</p>
              : <ul className="mt-1 list-disc pl-5 text-sm">{g.rows.map((i) => <li key={i.id}>{i.description}{i.severity && <span className={`ml-2 rounded px-1 text-xs ${i.severity === "severe" ? "bg-red-100 text-red-900" : "bg-slate-100"}`}>{i.severity}</span>}{view.level === "clinical" && <ResolveItem patientId={id} itemId={i.id} />}</li>)}</ul>}
          </div>))}
          {view.level === "clinical" && <AddClinicalItem patientId={id} />}
        </section>
        <section aria-labelledby="cons" className="mt-8"><h2 id="cons" className="mb-2 font-medium">Consent</h2>
          <ConsentPanel patientId={id} current={view.clinical.consents.map((c) => ({ kind: c.kind, granted: c.granted, policyVersion: c.policyVersion }))} />
        </section>
      </>)}
    </main>
  );
}
