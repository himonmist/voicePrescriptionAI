"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDay } from "@/lib/format";

interface Slot { startAt: string; date: string; time: string; mode: string; location: string | null }
type Mode = "in_person" | "online";

export function BookingPicker({ doctorId, doctorMode, viewer, fee }: { doctorId: string; doctorMode: string; viewer: "patient" | "other" | null; fee: number | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(doctorMode === "online" ? "online" : "in_person");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [sel, setSel] = useState<Slot | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string }>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setSlots(null); setSel(null);
    const r = await fetch(`/api/public/doctors/${doctorId}/slots?mode=${mode}`);
    setSlots(r.ok ? (await r.json()).slots : []);
  }, [doctorId, mode]);
  useEffect(() => { load(); }, [load]);

  async function book(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!sel) return;
    setBusy(true); setMsg(undefined);
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { doctorUserId: doctorId, startAt: sel.startAt, mode, reason: String(f.get("reason") || "") || undefined };
    if (f.get("dob")) body.profile = { dob: f.get("dob"), sex: f.get("sex") || "unknown" };
    const r = await fetch("/api/appointments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.status === 201) return router.push("/patient/appointments");
    setMsg({ kind: "error", text: j.error ?? "Could not book" });
    if (r.status === 409) load(); // slot was taken: refresh the list
  }

  const byDate = (slots ?? []).reduce<Record<string, Slot[]>>((m, s) => ((m[s.date] ??= []).push(s), m), {});
  return (
    <section aria-labelledby="book" className="mt-8">
      <h2 id="book" className="text-xl font-semibold">Book an appointment</h2>
      {doctorMode === "both" && (
        <div role="radiogroup" aria-label="Consultation mode" className="mt-3 flex gap-2">{(["in_person", "online"] as Mode[]).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded border px-3 py-1 text-sm ${mode === m ? "bg-slate-900 text-white" : ""}`}>{m === "in_person" ? "In person" : "Online"}</button>))}</div>)}
      {slots === null ? <p className="mt-4 text-slate-600" role="status">Loading available times…</p>
        : slots.length === 0 ? <p className="mt-4 text-slate-600">No open times in the next two weeks.</p>
        : <div className="mt-4 space-y-3">{Object.entries(byDate).map(([date, list]) => (
            <div key={date}><h3 className="text-sm font-medium">{fmtDay(date)}</h3>
              <div className="mt-1 flex flex-wrap gap-2">{list.map((s) => <button key={s.startAt} aria-pressed={sel?.startAt === s.startAt} onClick={() => setSel(s)} className={`rounded border px-2 py-1 text-sm ${sel?.startAt === s.startAt ? "bg-[var(--brand)] text-white" : ""}`}>{s.time}</button>)}</div></div>))}</div>}
      {sel && viewer === "patient" && (
        <form onSubmit={book} className="mt-6 space-y-3 rounded border p-4">
          <p className="text-sm">Selected: <strong>{fmtDay(sel.date)} at {sel.time}</strong> ({mode === "online" ? "online" : "in person"}{sel.location ? `, ${sel.location}` : ""}){fee != null && <> · Fee ৳{fee} (payment is collected at the visit until online payment is enabled)</>}</p>
          <label className="block text-sm">Reason for visit (optional)<input name="reason" maxLength={200} className="mt-1 w-full rounded border p-2" /></label>
          <fieldset className="grid grid-cols-2 gap-3 text-sm"><legend className="mb-1">First booking? We need a few details</legend>
            <label>Date of birth<input name="dob" type="date" className="mt-1 w-full rounded border p-2" /></label>
            <label>Sex<select name="sex" className="mt-1 w-full rounded border p-2"><option value="unknown">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label></fieldset>
          <button disabled={busy} className="rounded bg-[var(--brand)] px-4 py-2 font-medium text-white disabled:opacity-60">{busy ? "Booking…" : "Confirm booking"}</button>
        </form>)}
      {sel && viewer === null && <p className="mt-6 rounded border p-3 text-sm"><a className="underline" href="/login">Log in</a> or <a className="underline" href="/register/patient">create a patient account</a> to book {fmtDay(sel.date)} at {sel.time}.</p>}
      {sel && viewer === "other" && <p className="mt-6 rounded border p-3 text-sm">Booking as a patient requires a patient account.</p>}
      {msg && <p role="alert" className="mt-3 text-sm text-red-700">Error: {msg.text}</p>}
    </section>
  );
}
