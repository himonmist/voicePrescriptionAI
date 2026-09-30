"use client";
import { useCallback, useEffect, useState } from "react";

interface Link { id: string; createdAt: string; expiresAt: string; revoked: boolean; locked: boolean; expired: boolean; accessCount: number }

export function ShareLinks({ prescriptionId }: { prescriptionId: string }) {
  const [links, setLinks] = useState<Link[]>([]); const [days, setDays] = useState(7); const [fresh, setFresh] = useState<string>(); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  const api = `/api/prescriptions/${prescriptionId}/shares`;
  const load = useCallback(async () => { const r = await fetch(api); if (r.ok) setLinks(await r.json()); }, [api]);
  useEffect(() => { void load(); }, [load]);
  async function create() {
    setBusy(true); setErr(undefined); setFresh(undefined);
    const r = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expiresInDays: days }) }); const j = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) { setFresh(`${window.location.origin}${j.path}`); void load(); } else setErr(j.error ?? "Could not create link");
  }
  async function revoke(id: string) { if (!window.confirm("Revoke this link? The patient will no longer be able to open it.")) return; await fetch(`${api}/${id}`, { method: "DELETE" }); void load(); }
  const state = (l: Link) => l.revoked ? "Revoked" : l.locked ? "Locked (too many wrong attempts)" : l.expired ? "Expired" : "Active";
  return (
    <section aria-label="Share with patient" className="space-y-2 border-t pt-4">
      <h2 className="font-medium">Share with patient</h2>
      <p className="text-sm text-slate-700">Creates a private link. The patient must enter their date of birth to open it. The link is shown only once — copy it now and send it yourself (in-app delivery by SMS/email is not available yet).</p>
      <div className="flex items-end gap-2"><label className="text-xs">Expires in<select value={days} onChange={(e) => setDays(Number(e.target.value))} className="ml-1 rounded border px-2 py-1 text-sm">{[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}</select></label>
        <button disabled={busy} onClick={create} className="rounded border px-4 py-2 text-sm disabled:opacity-50">Create link</button></div>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      {fresh && <p role="status" className="break-all rounded border-2 border-green-700 bg-green-50 p-2 text-sm"><strong>Copy now (shown once):</strong> <code>{fresh}</code> <button className="ml-2 underline" onClick={() => navigator.clipboard?.writeText(fresh)}>Copy</button></p>}
      {links.length > 0 && <ul className="divide-y text-sm">{links.map((l) => <li key={l.id} className="flex items-center justify-between py-1"><span>{state(l)} · expires {l.expiresAt.slice(0, 10)} · opened {l.accessCount}×</span>{state(l) === "Active" && <button onClick={() => revoke(l.id)} className="text-red-800 underline">Revoke</button>}</li>)}</ul>}
    </section>
  );
}
