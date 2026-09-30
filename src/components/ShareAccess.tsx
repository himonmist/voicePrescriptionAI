"use client";
import { useState } from "react";

interface Doc { userId: string; fullName: string; specialty: string; bmdcNumber: string }

/** Treating doctor shares this record with another verified doctor for a limited time. Recipients are found in the public verified-doctor directory. */
export function ShareAccess({ patientId }: { patientId: string }) {
  const [q, setQ] = useState(""); const [found, setFound] = useState<Doc[]>([]); const [pick, setPick] = useState<Doc>(); const [reason, setReason] = useState(""); const [days, setDays] = useState(14); const [msg, setMsg] = useState<{ ok: boolean; t: string }>(); const [busy, setBusy] = useState(false);
  async function search(e: React.FormEvent) { e.preventDefault(); const r = await fetch(`/api/public/doctors?q=${encodeURIComponent(q)}`); setFound(r.ok ? (await r.json()).rows : []); }
  async function share() {
    if (!pick) return; setBusy(true); setMsg(undefined);
    const r = await fetch(`/api/patients/${patientId}/access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doctorUserId: pick.userId, reason, expiresInDays: days }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    setMsg(r.ok ? { ok: true, t: `Shared with ${pick.fullName} for ${days} days.` } : { ok: false, t: j.error ?? "Could not share" }); if (r.ok) { setPick(undefined); setReason(""); }
  }
  async function stop() {
    if (!pick || !window.confirm(`End ${pick.fullName}'s access to this record?`)) return;
    const r = await fetch(`/api/patients/${patientId}/access`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ doctorUserId: pick.userId }) });
    setMsg(r.ok ? { ok: true, t: "Access ended." } : { ok: false, t: ((await r.json().catch(() => ({}))).error as string) ?? "Could not end access" });
  }
  const inp = "rounded border px-2 py-1 text-sm";
  return (
    <details className="mt-6 rounded border p-3"><summary className="cursor-pointer font-medium">Share this record with another doctor</summary>
      <p className="mt-2 text-xs text-slate-600">They will see the clinical record for a limited time (max 90 days) and cannot re-share it. Every share is audited. Only verified doctors listed in the public directory can be found here.</p>
      <form onSubmit={search} className="mt-3 flex gap-2"><input aria-label="Search doctors" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or specialty" className={`${inp} flex-1`} /><button className={inp}>Search</button></form>
      {found.length > 0 && <ul className="mt-2 divide-y text-sm">{found.map((d) => <li key={d.userId} className="flex items-center justify-between py-1"><span>{d.fullName} · {d.specialty} · BMDC {d.bmdcNumber}</span><button type="button" className="underline" onClick={() => setPick(d)}>{pick?.userId === d.userId ? "Selected" : "Select"}</button></li>)}</ul>}
      {pick && <div className="mt-3 space-y-2"><p className="text-sm">Selected: <strong>{pick.fullName}</strong></p>
        <label className="block text-sm">Reason (required)<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={`${inp} mt-1 w-full`} /></label>
        <label className="text-sm">Access for<select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inp} ml-2`}>{[1, 7, 14, 30, 90].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}</select></label>
        <div className="flex gap-2"><button disabled={busy || reason.trim().length < 5} onClick={share} className="rounded bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Share</button><button onClick={stop} className={inp}>End their access</button></div></div>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.t}</p>}
    </details>
  );
}
