"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function StartConsultation({ appointmentId, patientId, label }: { appointmentId?: string; patientId?: string; label: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  async function go() {
    setBusy(true); setErr(undefined);
    const r = await fetch("/api/consultations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(appointmentId ? { appointmentId } : { patientId }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) router.push(`/doctor/consultations/${j.consultationId}`); else setErr(j.error ?? "Could not start");
  }
  return <span><button onClick={go} disabled={busy} className="rounded bg-[var(--brand)] px-3 py-1 text-sm font-medium text-white disabled:opacity-60">{busy ? "Opening…" : label}</button>{err && <span role="alert" className="ml-2 text-sm text-red-700">Error: {err}</span>}</span>;
}
