"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function StartPrescription({ consultationId }: { consultationId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  async function go() {
    setBusy(true); setErr(undefined);
    const r = await fetch(`/api/consultations/${consultationId}/prescription`, { method: "POST", headers: { "content-type": "application/json" } });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) router.push(`/doctor/prescriptions/${j.prescriptionId}`); else setErr(j.error ?? "Could not open the prescription");
  }
  return <span><button onClick={go} disabled={busy} className="rounded border border-slate-900 px-4 py-2 text-sm font-medium disabled:opacity-60">{busy ? "Opening…" : "Prescription"}</button>{err && <span role="alert" className="ml-2 text-sm text-red-700">Error: {err}</span>}</span>;
}
