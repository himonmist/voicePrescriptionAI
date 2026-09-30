"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

async function call(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.ok ? null : ((await r.json().catch(() => ({}))).error ?? "Request failed") as string;
}

export function AddClinicalItem({ patientId }: { patientId: string }) {
  const router = useRouter(); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = e.currentTarget; setBusy(true); setErr(undefined);
    const d = Object.fromEntries(new FormData(f).entries());
    const e2 = await call(`/api/patients/${patientId}/clinical-items`, "POST", { kind: d.kind, description: d.description, severity: d.severity || undefined });
    setBusy(false); if (e2) setErr(e2); else { f.reset(); router.refresh(); }
  }
  return (
    <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
      <label>Type<select name="kind" className="ml-1 rounded border p-1"><option value="allergy">Allergy</option><option value="condition">Condition</option><option value="medication">Current medication</option><option value="immunization">Immunization</option><option value="family_history">Family history</option><option value="procedure">Procedure</option></select></label>
      <label className="grow">Details<input name="description" required minLength={2} className="ml-1 w-full rounded border p-1" /></label>
      <label>Severity<select name="severity" className="ml-1 rounded border p-1"><option value="">—</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option></select></label>
      <button disabled={busy} className="rounded border px-3 py-1 disabled:opacity-50">Add</button>
      {err && <span role="alert" className="text-red-700">Error: {err}</span>}
    </form>
  );
}

export function ResolveItem({ patientId, itemId }: { patientId: string; itemId: string }) {
  const router = useRouter(); const [err, setErr] = useState<string>();
  async function go(status: "resolved" | "entered_in_error") {
    const reason = window.prompt(status === "resolved" ? "Why is this resolved?" : "Why was this entered in error?")?.trim();
    if (!reason) return;
    const e = await call(`/api/patients/${patientId}/clinical-items/${itemId}`, "PATCH", { status, reason });
    if (e) setErr(e); else router.refresh();
  }
  return <span className="ml-2 text-xs"><button onClick={() => go("resolved")} className="underline">resolve</button> · <button onClick={() => go("entered_in_error")} className="underline">entered in error</button>{err && <span role="alert" className="ml-2 text-red-700">{err}</span>}</span>;
}

const CONSENTS = [["treatment", "Treatment"], ["recording", "Consultation audio recording"], ["ai_processing", "AI processing of the transcript (sent to an external AI provider)"], ["data_sharing", "Data sharing"], ["sms", "SMS"], ["email", "Email"], ["whatsapp", "WhatsApp"]] as const;

export function ConsentPanel({ patientId, current }: { patientId: string; current: { kind: string; granted: boolean; policyVersion: string }[] }) {
  const router = useRouter(); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  async function set(kind: string, granted: boolean) {
    setBusy(true); setErr(undefined);
    const e = await call(`/api/patients/${patientId}/consents`, "POST", { kind, granted, method: "in_person" });
    setBusy(false); if (e) setErr(e); else router.refresh();
  }
  return (
    <div>
      <ul className="divide-y rounded border text-sm">{CONSENTS.map(([k, label]) => {
        const c = current.find((x) => x.kind === k);
        return (<li key={k} className="flex items-center justify-between p-2">
          <span>{label}: <strong>{c ? (c.granted ? "Granted" : "Withdrawn") : "Not recorded"}</strong>{c && <span className="ml-2 text-xs text-slate-500">policy {c.policyVersion}</span>}</span>
          <span className="space-x-2"><button disabled={busy} onClick={() => set(k, true)} className="rounded border px-2 py-0.5 disabled:opacity-50">Record granted</button><button disabled={busy} onClick={() => set(k, false)} className="rounded border px-2 py-0.5 disabled:opacity-50">Record withdrawn</button></span>
        </li>);
      })}</ul>
      <p className="mt-2 text-xs text-slate-500">Record consent only after the patient has been informed and has agreed in person. Absence of a record means no consent.</p>
      {err && <p role="alert" className="mt-1 text-sm text-red-700">Error: {err}</p>}
    </div>
  );
}
