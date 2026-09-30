"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDay } from "@/lib/format";

interface Slot { startAt: string; date: string; time: string; mode: string; location: string | null }

export function ReschedulePicker({ appointmentId, doctorId, mode, backHref }: { appointmentId: string; doctorId: string; mode: "in_person" | "online"; backHref: string }) {
  const router = useRouter(); const [slots, setSlots] = useState<Slot[] | null>(null); const [sel, setSel] = useState<Slot | null>(null); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  const load = () => { setSlots(null); fetch(`/api/public/doctors/${encodeURIComponent(doctorId)}/slots?mode=${mode}`).then(async (r) => setSlots(r.ok ? (await r.json()).slots : [])); };
  useEffect(load, [doctorId, mode]);
  async function move() {
    if (!sel) return; setBusy(true); setErr(undefined);
    const r = await fetch(`/api/appointments/${appointmentId}/reschedule`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startAt: sel.startAt, mode }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) { router.push(backHref); router.refresh(); return; }
    setErr(j.error ?? "Could not reschedule"); if (r.status === 409) load();
  }
  const byDate = (slots ?? []).reduce<Record<string, Slot[]>>((m, s) => ((m[s.date] ??= []).push(s), m), {});
  return (
    <div className="mt-4">
      {slots === null ? <p role="status" className="text-slate-600">Loading available times…</p> : slots.length === 0 ? <p className="text-slate-600">No open times in the next two weeks.</p>
        : <div className="space-y-3">{Object.entries(byDate).map(([date, list]) => <div key={date}><h3 className="text-sm font-medium">{fmtDay(date)}</h3><div className="mt-1 flex flex-wrap gap-2">{list.map((s) => <button key={s.startAt} aria-pressed={sel?.startAt === s.startAt} onClick={() => setSel(s)} className={`rounded border px-2 py-1 text-sm ${sel?.startAt === s.startAt ? "bg-[var(--brand)] text-white" : ""}`}>{s.time}</button>)}</div></div>)}</div>}
      <div className="mt-6 flex items-center gap-3"><button disabled={!sel || busy} onClick={move} className="rounded bg-[var(--brand)] px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? "Moving…" : sel ? `Move to ${fmtDay(sel.date)} ${sel.time}` : "Pick a new time"}</button><a href={backHref} className="text-sm underline">Cancel</a></div>
      {err && <p role="alert" className="mt-3 text-sm text-red-700">Error: {err}</p>}
    </div>
  );
}
