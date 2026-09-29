"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { WEEKDAYS } from "@/lib/format";

export interface RuleRow { weekday: number; startTime: string; endTime: string; slotMinutes: number; bufferMinutes: number; mode: string; location: string | null; maxPerDay: number | null }
export interface ExRow { id: string; date: string; kind: string; startTime: string | null; endTime: string | null; reason: string | null }

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.ok ? null : (((await r.json().catch(() => ({}))).error as string) ?? "Failed");
}

export function ScheduleEditor({ initial, exceptions }: { initial: RuleRow[]; exceptions: ExRow[] }) {
  const router = useRouter();
  const [rules, setRules] = useState<RuleRow[]>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>(); const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<RuleRow>) => setRules((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const c = "rounded border p-1 text-sm";

  async function save() { setBusy(true); setMsg(undefined); const e = await call("/api/doctor/availability", "PUT", { rules: rules.map((r) => ({ ...r, location: r.location || null })) }); setBusy(false); setMsg(e ? { ok: false, text: e } : { ok: true, text: "Schedule saved. Existing appointments are not changed." }); }
  async function addEx(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = e.currentTarget; const d = Object.fromEntries(new FormData(f).entries()) as Record<string, string>;
    const body: Record<string, string> = { date: d.date, kind: d.kind }; if (d.kind === "block" && d.startTime) { body.startTime = d.startTime; body.endTime = d.endTime; } if (d.reason) body.reason = d.reason;
    const err = await call("/api/doctor/availability/exceptions", "POST", body); if (err) setMsg({ ok: false, text: err }); else { f.reset(); router.refresh(); }
  }
  async function delEx(id: string) { const err = await call(`/api/doctor/availability/exceptions/${id}`, "DELETE"); if (err) setMsg({ ok: false, text: err }); else router.refresh(); }

  return (
    <div>
      <h2 className="font-medium">Weekly hours <span className="text-sm font-normal text-slate-500">(Bangladesh time)</span></h2>
      {rules.length === 0 && <p className="mt-2 text-sm text-slate-600">No hours set: patients cannot book you.</p>}
      <div className="mt-2 space-y-2">{rules.map((r, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded border p-2">
          <label className="text-xs">Day<select aria-label="Day" className={`${c} block`} value={r.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })}>{WEEKDAYS.map((d, n) => <option key={n} value={n}>{d}</option>)}</select></label>
          <label className="text-xs">From<input type="time" className={`${c} block`} value={r.startTime} onChange={(e) => set(i, { startTime: e.target.value })} /></label>
          <label className="text-xs">To<input type="time" className={`${c} block`} value={r.endTime} onChange={(e) => set(i, { endTime: e.target.value })} /></label>
          <label className="text-xs">Slot (min)<input type="number" min={5} max={240} className={`${c} block w-20`} value={r.slotMinutes} onChange={(e) => set(i, { slotMinutes: Number(e.target.value) })} /></label>
          <label className="text-xs">Buffer<input type="number" min={0} max={120} className={`${c} block w-16`} value={r.bufferMinutes} onChange={(e) => set(i, { bufferMinutes: Number(e.target.value) })} /></label>
          <label className="text-xs">Mode<select className={`${c} block`} value={r.mode} onChange={(e) => set(i, { mode: e.target.value })}><option value="both">Both</option><option value="in_person">In person</option><option value="online">Online</option></select></label>
          <label className="text-xs">Location<input className={`${c} block w-32`} value={r.location ?? ""} onChange={(e) => set(i, { location: e.target.value })} /></label>
          <label className="text-xs">Max/day<input type="number" min={1} className={`${c} block w-16`} value={r.maxPerDay ?? ""} onChange={(e) => set(i, { maxPerDay: e.target.value ? Number(e.target.value) : null })} /></label>
          <button type="button" onClick={() => setRules((x) => x.filter((_, j) => j !== i))} className="text-sm underline">remove</button>
        </div>))}</div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => setRules((r) => [...r, { weekday: 1, startTime: "09:00", endTime: "13:00", slotMinutes: 20, bufferMinutes: 0, mode: "both", location: "", maxPerDay: null }])} className="rounded border px-3 py-1 text-sm">Add session</button>
        <button type="button" onClick={save} disabled={busy} className="rounded bg-[var(--brand)] px-4 py-1 text-sm font-medium text-white disabled:opacity-60">{busy ? "Saving…" : "Save schedule"}</button>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.ok ? msg.text : `Error: ${msg.text}`}</p>}

      <h2 className="mt-10 font-medium">Holidays & breaks</h2>
      <form onSubmit={addEx} className="mt-2 flex flex-wrap items-end gap-2 text-sm">
        <label>Date<input name="date" type="date" required className={`${c} ml-1`} /></label>
        <label>Type<select name="kind" className={`${c} ml-1`}><option value="holiday">Whole day off</option><option value="block">Time block</option></select></label>
        <label>From<input name="startTime" type="time" className={`${c} ml-1`} /></label><label>To<input name="endTime" type="time" className={`${c} ml-1`} /></label>
        <label>Reason<input name="reason" className={`${c} ml-1`} /></label>
        <button className="rounded border px-3 py-1">Add</button>
      </form>
      <ul className="mt-3 divide-y rounded border text-sm">{exceptions.length === 0 ? <li className="p-2 text-slate-500">None.</li> : exceptions.map((x) => (
        <li key={x.id} className="flex items-center justify-between p-2"><span>{x.date} · {x.kind === "holiday" ? "day off" : `${x.startTime}–${x.endTime}`}{x.reason ? ` · ${x.reason}` : ""}</span><button onClick={() => delEx(x.id)} className="underline">remove</button></li>))}</ul>
    </div>
  );
}
