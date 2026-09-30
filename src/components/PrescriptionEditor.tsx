"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Item, PrescriptionContent } from "@/server/prescriptions/content";

interface Alert { key: string; kind: string; severity: "info" | "warning" | "high" | "critical"; message: string; source?: string; requiresOverride: boolean }
interface Screening { alerts: Alert[]; limits: string[]; overridesNeeded: string[]; description: { message: string } }
interface DrugHit { id: string; genericName: string; strength: string; dosageForm: string; route: string | null; brandNames: string[]; sourceLabel: string; sourceDate: string; highRisk: boolean; indications: string | null; contraindications: string | null; warnings: string | null }
interface Props { id: string; code: string; status: string; version: number; content: PrescriptionContent; screening: Screening; issues: string[] }
type Json = Record<string, unknown>;

async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, data: (await r.json().catch(() => ({}))) as Json };
}
const SEV: Record<Alert["severity"], string> = { critical: "CRITICAL", high: "HIGH", warning: "Warning", info: "Info" };
const blank = (name: string): Item => ({ drugRefId: null, genericName: name, brandName: null, strength: null, dosageForm: null, route: null, dose: null, frequency: null, timing: null, duration: null, quantity: null, refills: null, warnings: null, comments: null, unresolved: [] });
const CONFIRMABLE: [Item["unresolved"][number], string][] = [["dose", "dose"], ["frequency", "frequency"], ["duration", "duration"], ["strength", "strength"]];

export function PrescriptionEditor(p: Props) {
  const router = useRouter();
  const [c, setC] = useState<PrescriptionContent>(p.content);
  const [version, setVersion] = useState(p.version);
  const [status, setStatus] = useState(p.status);
  const [screen, setScreen] = useState(p.screening); const [issues, setIssues] = useState(p.issues);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>(); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const draft = status === "draft";
  const say = (ok: boolean, text: string) => setMsg({ ok, text });
  const edit = (fn: (x: PrescriptionContent) => PrescriptionContent) => { setC(fn); setDirty(true); };
  const setItem = (i: number, patch: Partial<Item>) => edit((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  // Local backup: typed clinical text survives a refresh; the server stays the source of truth.
  const key = `rx-draft:${p.id}:${version}`; const [restorable, setRestorable] = useState<string | null>(null);
  useEffect(() => { try { const s = localStorage.getItem(key); if (s && draft) setRestorable(s); } catch {} }, [key, draft]);
  useEffect(() => { if (!dirty) return; const t = setTimeout(() => { try { localStorage.setItem(key, JSON.stringify(c)); } catch {} }, 600); return () => clearTimeout(t); }, [c, dirty, key]);

  async function reload() { const r = await api(`/api/prescriptions/${p.id}`, "GET"); if (r.ok) { setScreen(r.data.screening as Screening); setIssues(r.data.issues as string[]); setVersion(r.data.version as number); setStatus((r.data.prescription as { status: string }).status); if (!draft) setC(r.data.content as PrescriptionContent); } }
  async function save(): Promise<boolean> {
    setBusy(true); setMsg(undefined);
    const r = await api(`/api/prescriptions/${p.id}`, "PUT", { baseVersion: version, content: c }); setBusy(false);
    if (r.ok) { setVersion(r.data.version as number); setDirty(false); try { localStorage.removeItem(key); } catch {} await reload(); say(true, `Saved (version ${r.data.version}).`); return true; }
    say(false, r.status === 409 ? "This prescription was changed elsewhere. Your text is still here — copy it, reload, and re-apply." : String(r.data.error ?? "Could not save")); return false;
  }
  async function act(path: string, body?: unknown, ok?: string) { setBusy(true); setMsg(undefined); const r = await api(`/api/prescriptions/${p.id}/${path}`, "POST", body); setBusy(false); if (r.ok) { if (ok) say(true, ok); await reload(); router.refresh(); return r; } say(false, String(r.data.error ?? "Failed")); return null; }

  // ---- drug search ----
  const [q, setQ] = useState(""); const [hits, setHits] = useState<DrugHit[] | null>(null); const [cov, setCov] = useState<string>();
  async function search(e: React.FormEvent) { e.preventDefault(); if (q.trim().length < 2) return; const r = await api(`/api/drugs?q=${encodeURIComponent(q.trim())}`, "GET"); if (r.ok) { setHits(r.data.results as DrugHit[]); setCov((r.data.coverage as { message: string }).message); } else say(false, String(r.data.error ?? "Search failed")); }
  const addRef = (d: DrugHit) => { edit((x) => ({ ...x, items: [...x.items, { ...blank(d.genericName), drugRefId: d.id, strength: d.strength, dosageForm: d.dosageForm, route: d.route, brandName: d.brandNames[0] ?? null }] })); setHits(null); setQ(""); };

  const overrideFor = (k: string) => c.overrides.find((o) => o.alertKey === k)?.reason ?? "";
  const setOverride = (k: string, reason: string) => edit((x) => ({ ...x, overrides: [...x.overrides.filter((o) => o.alertKey !== k), ...(reason ? [{ alertKey: k, reason }] : [])] }));

  const [pw, setPw] = useState("");
  const inp = "w-full rounded border p-1.5 text-sm";
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-semibold">Prescription <span className="text-base font-normal text-slate-600">{p.code}</span></h1>
        <span className="rounded bg-slate-100 px-2 py-1 text-sm capitalize" aria-label="Status">{status}</span></header>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded p-2 text-sm ${msg.ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>{msg.ok ? msg.text : `Error: ${msg.text}`}</p>}
      {!draft && <p className="rounded border p-3 text-sm">{status === "approved" ? "Approved. Reopen to edit, or sign to finalize." : status === "finalized" ? "Finalized and sealed. It can no longer be edited; use “Amend” to issue a corrected version." : `This prescription is ${status}.`}</p>}
      {restorable && <p className="rounded border border-amber-400 bg-amber-50 p-2 text-sm">Unsaved text from a previous session was found. <button className="underline" onClick={() => { setC(JSON.parse(restorable)); setDirty(true); setRestorable(null); }}>Restore</button> · <button className="underline" onClick={() => { try { localStorage.removeItem(key); } catch {} setRestorable(null); }}>Discard</button></p>}

      <section aria-labelledby="ctx"><h2 id="ctx" className="font-medium">Clinical context</h2>
        <p className="mt-1 text-sm"><strong>Allergies on record:</strong> {c.allergiesSnapshot.length ? <span className="font-medium">⚠ {c.allergiesSnapshot.join("; ")}</span> : <em>none recorded (confirm with the patient)</em>}</p>
        {c.chiefComplaint && <p className="text-sm"><strong>Complaint:</strong> {c.chiefComplaint}</p>}
        <div className="mt-2 space-y-1">{c.diagnoses.map((d, i) => (<div key={i} className="flex gap-2 text-sm"><input aria-label="Diagnosis" disabled={!draft} value={d.text} onChange={(e) => edit((x) => ({ ...x, diagnoses: x.diagnoses.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) }))} className={inp} />
          <select aria-label="Diagnosis status" disabled={!draft} value={d.status} onChange={(e) => edit((x) => ({ ...x, diagnoses: x.diagnoses.map((y, j) => (j === i ? { ...y, status: e.target.value as "provisional" | "confirmed" } : y)) }))} className="rounded border p-1.5"><option value="provisional">Provisional</option><option value="confirmed">Confirmed by me</option></select></div>))}</div></section>

      <section aria-labelledby="meds"><h2 id="meds" className="font-medium">Medicines</h2>
        {draft && (<form onSubmit={search} className="mt-2 flex gap-2" role="search"><label className="sr-only" htmlFor="dq">Search drug reference</label><input id="dq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the drug reference (generic or brand)" className={inp} /><button className="rounded border px-3 text-sm">Search</button>
          <button type="button" onClick={() => { const n = window.prompt("Drug name (not in the reference — it will be flagged as unchecked):")?.trim(); if (n) edit((x) => ({ ...x, items: [...x.items, blank(n)] })); }} className="whitespace-nowrap rounded border px-3 text-sm">Add manually</button></form>)}
        {cov && <p className="mt-2 rounded border border-dashed p-2 text-xs text-slate-700" role="note">{cov}</p>}
        {hits && (hits.length === 0 ? <p className="mt-2 text-sm text-slate-600">No matches in the loaded reference. You can add the drug manually.</p> : <ul className="mt-2 divide-y rounded border text-sm">{hits.map((d) => (<li key={d.id} className="p-2"><div className="flex items-start justify-between gap-2"><div><strong>{d.genericName}</strong> {d.strength} {d.dosageForm}{d.brandNames.length > 0 && ` (${d.brandNames.join(", ")})`}{d.highRisk && <span className="ml-2 rounded bg-red-100 px-1 text-xs">⚠ high-risk</span>}<p className="text-xs text-slate-500">Source: {d.sourceLabel} ({d.sourceDate})</p>{d.contraindications && <p className="text-xs">Contraindications: {d.contraindications}</p>}{d.warnings && <p className="text-xs">Warnings: {d.warnings}</p>}</div><button onClick={() => addRef(d)} className="rounded border px-2 py-1 text-xs">Add</button></div></li>))}</ul>)}
        {c.items.length === 0 ? <p className="mt-3 text-sm text-slate-600">No medicines added.</p> : <ol className="mt-3 space-y-3">{c.items.map((it, i) => (
          <li key={i} className="rounded border p-3"><div className="flex items-start justify-between gap-2"><p className="font-medium">{i + 1}. {it.genericName} {it.strength && <span className="font-normal">{it.strength}</span>} {it.dosageForm && <span className="font-normal">{it.dosageForm}</span>} {!it.drugRefId && <span className="ml-1 rounded bg-amber-100 px-1 text-xs font-normal">not in reference — unchecked</span>}</p>{draft && <button className="text-xs underline" onClick={() => edit((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }))}>remove</button>}</div>
            <fieldset disabled={!draft} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-xs">Strength<input className={inp} value={it.strength ?? ""} onChange={(e) => setItem(i, { strength: e.target.value || null })} /></label>
              <label className="text-xs">Dosage form<input className={inp} value={it.dosageForm ?? ""} onChange={(e) => setItem(i, { dosageForm: e.target.value || null })} /></label>
              <label className="text-xs">Route<input className={inp} value={it.route ?? ""} onChange={(e) => setItem(i, { route: e.target.value || null })} placeholder="e.g. oral" /></label>
              <label className="text-xs">Dose<input className={inp} value={it.dose ?? ""} onChange={(e) => setItem(i, { dose: e.target.value || null })} placeholder="e.g. 1 tablet" /></label>
              <label className="text-xs">Frequency<input className={inp} value={it.frequency ?? ""} onChange={(e) => setItem(i, { frequency: e.target.value || null })} placeholder="e.g. twice daily" /></label>
              <label className="text-xs">Timing<input className={inp} value={it.timing ?? ""} onChange={(e) => setItem(i, { timing: e.target.value || null })} placeholder="e.g. after meals" /></label>
              <div className="text-xs">Duration<div className="flex gap-1"><input aria-label="Duration value" type="number" min={1} max={365} className={inp} disabled={!!(it.duration && "ongoing" in it.duration)} value={it.duration && "value" in it.duration ? it.duration.value : ""} onChange={(e) => setItem(i, { duration: e.target.value ? { value: Number(e.target.value), unit: it.duration && "unit" in it.duration ? it.duration.unit : "days" } : null })} />
                <select aria-label="Duration unit" className="rounded border p-1.5 text-sm" value={it.duration && "unit" in it.duration ? it.duration.unit : "days"} onChange={(e) => setItem(i, { duration: { value: it.duration && "value" in it.duration ? it.duration.value : 1, unit: e.target.value as "days" } })}><option value="days">days</option><option value="weeks">weeks</option><option value="months">months</option></select></div>
                <label className="mt-1 flex items-center gap-1"><input type="checkbox" checked={!!(it.duration && "ongoing" in it.duration)} onChange={(e) => setItem(i, { duration: e.target.checked ? { ongoing: true } : null })} />ongoing</label></div>
              <label className="text-xs">Quantity<input className={inp} value={it.quantity ?? ""} onChange={(e) => setItem(i, { quantity: e.target.value || null })} /></label>
              <label className="col-span-2 text-xs">Patient-specific warnings<input className={inp} value={it.warnings ?? ""} onChange={(e) => setItem(i, { warnings: e.target.value || null })} /></label>
              <label className="col-span-2 text-xs">Comments<input className={inp} value={it.comments ?? ""} onChange={(e) => setItem(i, { comments: e.target.value || null })} /></label></fieldset>
            <p className="mt-2 text-xs">Not sure yet? Flag it — the prescription cannot be approved until it is confirmed: {CONFIRMABLE.map(([f, label]) => (<label key={f} className="ml-3 inline-flex items-center gap-1"><input type="checkbox" disabled={!draft} checked={it.unresolved.includes(f)} onChange={(e) => setItem(i, { unresolved: e.target.checked ? [...it.unresolved, f] : it.unresolved.filter((u) => u !== f) })} />{label}</label>))}</p>
          </li>))}</ol>}
      </section>

      <section aria-labelledby="alerts"><h2 id="alerts" className="font-medium">Safety review <span className="text-sm font-normal text-slate-500">(decision support — you remain responsible)</span></h2>
        <p className="mt-1 text-xs text-slate-600">{screen.description.message}</p>
        {screen.alerts.length === 0 ? <p className="mt-2 text-sm text-slate-600">No alerts were raised by the checks that ran. This is not a guarantee of safety — see the limits below.</p> : <ul className="mt-2 space-y-2">{screen.alerts.map((a) => (
          <li key={a.key} className={`rounded border-2 p-2 text-sm ${a.severity === "critical" || a.severity === "high" ? "border-red-700" : a.severity === "warning" ? "border-amber-600" : "border-slate-300"}`}>
            <p><span className="mr-2 rounded bg-slate-900 px-1.5 py-0.5 text-xs font-bold text-white">{SEV[a.severity]}</span>{a.message}{a.source && <span className="ml-2 text-xs text-slate-500">[{a.source}]</span>}</p>
            {a.requiresOverride && (draft ? <label className="mt-1 block text-xs">Override — document why this is acceptable, or remove the medicine (min 10 characters)<input value={overrideFor(a.key)} onChange={(e) => setOverride(a.key, e.target.value)} className={`${inp} mt-1`} maxLength={500} /></label> : <p className="mt-1 text-xs">Override: {overrideFor(a.key) || "—"}</p>)}
          </li>))}</ul>}
        <ul className="mt-3 list-disc pl-5 text-xs text-slate-700" aria-label="What was not screened">{screen.limits.map((l) => <li key={l}>{l}</li>)}</ul></section>

      <section aria-labelledby="more"><h2 id="more" className="font-medium">Investigations, advice, follow-up</h2>
        <fieldset disabled={!draft} className="mt-2 space-y-3">
          <label className="block text-sm">Investigations (one per line)<textarea rows={3} className={inp} value={c.investigations.join("\n")} onChange={(e) => edit((x) => ({ ...x, investigations: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) }))} /></label>
          <label className="block text-sm">Advice<textarea rows={3} maxLength={2000} className={inp} value={c.advice} onChange={(e) => edit((x) => ({ ...x, advice: e.target.value }))} /></label>
          <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">Follow-up date<input type="date" className={inp} value={c.followUp?.date ?? ""} onChange={(e) => edit((x) => ({ ...x, followUp: { date: e.target.value || null, text: x.followUp?.text ?? null } }))} /></label><label className="text-sm">Follow-up note<input className={inp} value={c.followUp?.text ?? ""} onChange={(e) => edit((x) => ({ ...x, followUp: { date: x.followUp?.date ?? null, text: e.target.value || null } }))} /></label></div>
          <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">Referral to<input className={inp} value={c.referral?.to ?? ""} onChange={(e) => edit((x) => ({ ...x, referral: { to: e.target.value || null, reason: x.referral?.reason ?? null } }))} /></label><label className="text-sm">Referral reason<input className={inp} value={c.referral?.reason ?? ""} onChange={(e) => edit((x) => ({ ...x, referral: { to: x.referral?.to ?? null, reason: e.target.value || null } }))} /></label></div>
          <label className="block text-sm">Print language<select className={inp} value={c.language} onChange={(e) => edit((x) => ({ ...x, language: e.target.value as "en" | "bn" }))}><option value="en">English</option><option value="bn">বাংলা</option></select></label>
        </fieldset></section>

      {issues.length > 0 && draft && <section aria-label="Still to complete"><h2 className="font-medium">To complete before approval</h2><ul className="mt-1 list-disc pl-5 text-sm text-red-900">{issues.map((x) => <li key={x}>{x}</li>)}</ul></section>}

      <section aria-label="Actions" className="flex flex-wrap items-end gap-2 border-t pt-4">
        {draft && <button disabled={busy || !dirty} onClick={save} className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Saving…" : dirty ? "Save draft" : "Saved"}</button>}
        {draft && <button disabled={busy} onClick={async () => { if (dirty && !(await save())) return; await act("approve", undefined, "Approved. Review and sign when ready."); }} className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50">Approve (I have reviewed this)</button>}
        {status === "approved" && <button disabled={busy} onClick={() => act("reopen", undefined, "Reopened for editing.")} className="rounded border px-4 py-2 text-sm">Reopen to edit</button>}
        {status === "approved" && (<form onSubmit={async (e) => { e.preventDefault(); const r = await act("finalize", { password: pw }, "Signed and sealed."); setPw(""); if (r) router.refresh(); }} className="flex items-end gap-2"><label className="text-xs">Your password to sign<input type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} className={`${inp} w-44`} /></label><button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Sign &amp; finalize</button></form>)}
        {status === "finalized" && <><a href={`/doctor/prescriptions/${p.id}/print`} className="rounded border px-4 py-2 text-sm">Print / PDF</a><a href={`/verify/${p.code}`} className="rounded border px-4 py-2 text-sm">Verification page</a>
          <button disabled={busy} onClick={async () => { const reason = window.prompt("Reason for amending (min 10 characters). The original stays on record as superseded:")?.trim(); if (!reason) return; const r = await act("amend", { reason }); if (r) router.push(`/doctor/prescriptions/${r.data.prescriptionId}`); }} className="rounded border px-4 py-2 text-sm">Amend</button></>}
        {(status === "draft" || status === "approved" || status === "finalized") && <button disabled={busy} onClick={async () => { const reason = window.prompt("Reason for cancelling (min 10 characters):")?.trim(); if (reason) await act("cancel", { reason }, "Cancelled."); }} className="rounded border border-red-700 px-4 py-2 text-sm text-red-800">Cancel prescription</button>}
      </section>
    </div>
  );
}
