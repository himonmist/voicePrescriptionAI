"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SECTION_KEYS, SECTION_LABELS, type NoteContent, type SectionKey, type Vitals } from "@/server/consultations/note";

interface Seg { id: string; seq: number; speaker: string; text: string; originalText: string | null; startMs?: number | null; flagged: boolean }
interface Props {
  id: string; patientId: string; completed: boolean;
  patient: { name: string; dob: string; sex: string; allergies: string[] };
  consentRecording: boolean; segments: Seg[];
  note: { status: string; currentVersion: number; content: NoteContent } | null; warnings: string[];
}
type Json = Record<string, unknown>;
async function api(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Json }> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}
const age = (dob: string) => Math.floor((Date.now() - Date.parse(dob)) / 31_557_600_000);
const mmss = (ms?: number | null) => (ms == null ? "" : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`);
const VITAL_FIELDS: [keyof Vitals, string, string][] = [["bpSystolic", "BP systolic", "mmHg"], ["bpDiastolic", "BP diastolic", "mmHg"], ["pulse", "Pulse", "/min"], ["respRate", "Resp. rate", "/min"], ["tempC", "Temp", "°C"], ["spo2", "SpO₂", "%"], ["weightKg", "Weight", "kg"], ["heightCm", "Height", "cm"]];

export function ConsultationWorkspace(p: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const say = (ok: boolean, text: string) => setMsg({ ok, text });

  // ---- transcript ----
  const [speaker, setSpeaker] = useState("doctor"); const [line, setLine] = useState("");
  async function addLine(e: React.FormEvent) { e.preventDefault(); if (!line.trim()) return; const r = await api(`/api/consultations/${p.id}/transcript`, "POST", { speaker, text: line }); if (r.ok) { setLine(""); router.refresh(); } else say(false, String(r.data.error ?? "Failed")); }
  async function patchSeg(sid: string, patch: Json) { const r = await api(`/api/consultations/${p.id}/transcript/${sid}`, "PATCH", patch); if (r.ok) router.refresh(); else say(false, String(r.data.error ?? "Failed")); }

  // ---- note ----
  const initial = useMemo(() => p.note?.content, [p.note]);
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(SECTION_KEYS.map((k) => [k, initial?.sections[k].text ?? ""])));
  const [vitals, setVitals] = useState<Record<string, string>>(() => Object.fromEntries(VITAL_FIELDS.map(([k]) => [k, initial?.vitals?.[k] !== undefined ? String(initial.vitals[k]) : ""])));
  const [dx, setDx] = useState<{ text: string; status: string }[]>(initial?.diagnoses ?? []);
  const [version, setVersion] = useState(p.note?.currentVersion ?? 0);
  const [warnings, setWarnings] = useState<string[]>(p.warnings);
  const [amend, setAmend] = useState(""); const [busy, setBusy] = useState(false);
  const approved = p.note?.status === "approved";
  const draftKey = `note-draft:${p.id}:${version}`;
  const [restorable, setRestorable] = useState<string | null>(null);

  // Local backup so a refresh/crash never loses typed clinical text (server remains the source of truth).
  useEffect(() => { try { const s = localStorage.getItem(draftKey); if (s) setRestorable(s); } catch {} }, [draftKey]);
  useEffect(() => { const t = setTimeout(() => { try { localStorage.setItem(draftKey, JSON.stringify({ texts, vitals, dx })); } catch {} }, 600); return () => clearTimeout(t); }, [texts, vitals, dx, draftKey]);

  function buildContent() {
    const sections: Json = {};
    for (const k of SECTION_KEYS) if (texts[k]?.trim()) sections[k] = { state: "documented", text: texts[k] };
    const v: Json = {}; for (const [k] of VITAL_FIELDS) if (vitals[k] !== "") v[k] = Number(vitals[k]);
    return { sections, vitals: Object.keys(v).length ? v : null, diagnoses: dx.filter((d) => d.text.trim()) };
  }
  async function save() {
    setBusy(true); setMsg(undefined);
    const r = await api(`/api/consultations/${p.id}/note`, "PUT", { baseVersion: version, content: buildContent(), amendmentReason: approved ? amend : undefined });
    setBusy(false);
    if (r.ok) { setVersion(Number(r.data.version)); setWarnings((r.data.warnings as string[]) ?? []); setAmend(""); try { localStorage.removeItem(draftKey); } catch {} say(true, `Saved as version ${r.data.version}.`); router.refresh(); }
    else if (r.status === 409) say(false, "This note was changed elsewhere (another tab or device). Your text is still here — copy it, reload the page, and re-apply.");
    else say(false, String(r.data.error ?? "Could not save"));
  }
  async function approve() { if (!window.confirm("Approve this note? Later changes will be recorded as amendments with a reason.")) return; const r = await api(`/api/consultations/${p.id}/note/approve`, "POST"); if (r.ok) { say(true, "Note approved."); router.refresh(); } else say(false, String(r.data.error ?? "Failed")); }
  async function complete() { if (!window.confirm("Complete this consultation? The transcript will be locked.")) return; const r = await api(`/api/consultations/${p.id}/complete`, "POST"); if (r.ok) router.refresh(); else say(false, String(r.data.error ?? "Failed")); }
  async function setConsent(granted: boolean) {
    if (granted && !window.confirm("Confirm that the patient has been informed and has agreed to audio recording of this consultation.")) return;
    const r = await api(`/api/patients/${p.patientId}/consents`, "POST", { kind: "recording", granted, method: "in_person" }); if (r.ok) router.refresh(); else say(false, String(r.data.error ?? "Failed"));
  }
  const [versions, setVersions] = useState<{ version: number; kind: string; authorName: string; summary: string | null; createdAt: string }[] | null>(null);
  async function loadVersions() { const r = await api(`/api/consultations/${p.id}/note/versions`, "GET"); if (r.ok) setVersions(r.data.versions as never); }

  const c = "w-full rounded border p-2 text-sm";
  return (
    <div className="space-y-8">
      <header className="rounded border p-4">
        <h1 className="text-2xl font-semibold">{p.patient.name} <span className="text-base font-normal text-slate-600">· {p.patient.sex} · {age(p.patient.dob)} y</span></h1>
        <p className="mt-2 text-sm" role="note"><strong>Allergies:</strong> {p.patient.allergies.length ? <span className="font-medium">⚠ {p.patient.allergies.join("; ")}</span> : <em>none recorded (not the same as “no known allergies” — confirm with the patient)</em>}</p>
        {p.completed && <p className="mt-2 rounded bg-slate-100 p-2 text-sm">This consultation is completed. The transcript is locked.</p>}
      </header>

      {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded p-2 text-sm ${msg.ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>{msg.ok ? msg.text : `Error: ${msg.text}`}</p>}

      <section aria-labelledby="rec"><h2 id="rec" className="font-medium">Recording &amp; consent</h2>
        <p className="mt-2 text-sm">Recording consent: <strong>{p.consentRecording ? "Granted" : "Not recorded"}</strong>
          {!p.completed && (p.consentRecording
            ? <button onClick={() => setConsent(false)} className="ml-3 rounded border px-2 py-0.5">Record withdrawal</button>
            : <button onClick={() => setConsent(true)} className="ml-3 rounded border px-2 py-0.5">Record consent given</button>)}</p>
        <p className="mt-2 rounded border border-dashed p-3 text-sm text-slate-700"><strong>Audio capture is not available.</strong> No speech-to-text provider is configured, so nothing is recorded or stored. Type or paste the conversation below. When a provider is enabled, recording will start only if consent is recorded here, and withdrawing consent stops it immediately.</p>
      </section>

      <section aria-labelledby="tr"><h2 id="tr" className="font-medium">Transcript</h2>
        {p.segments.length === 0 ? <p className="mt-2 text-sm text-slate-600">No transcript yet.</p> : (
          <ol className="mt-2 divide-y rounded border text-sm">{p.segments.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 p-2">
              <div className="min-w-0 flex-1"><span className="mr-2 font-medium capitalize">{s.speaker}</span>{s.startMs != null && <span className="mr-2 text-xs text-slate-500">{mmss(s.startMs)}</span>}
                <span className="whitespace-pre-wrap">{s.text}</span>
                {s.flagged && <span className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-900">⚑ Uncertain — verify</span>}
                {s.originalText && <details className="text-xs text-slate-500"><summary>edited</summary>Original: {s.originalText}</details>}</div>
              {!p.completed && <div className="space-x-2 text-xs"><button className="underline" onClick={() => { const t = window.prompt("Edit line", s.text); if (t && t.trim() && t !== s.text) patchSeg(s.id, { text: t }); }}>edit</button><button className="underline" onClick={() => patchSeg(s.id, { flagged: !s.flagged })}>{s.flagged ? "clear flag" : "flag uncertain"}</button></div>}
            </li>))}</ol>)}
        {!p.completed && (
          <form onSubmit={addLine} className="mt-3 flex flex-wrap gap-2"><label className="sr-only" htmlFor="sp">Speaker</label>
            <select id="sp" value={speaker} onChange={(e) => setSpeaker(e.target.value)} className="rounded border p-2 text-sm"><option value="doctor">Doctor</option><option value="patient">Patient</option><option value="other">Other</option><option value="unknown">Unknown</option></select>
            <label className="sr-only" htmlFor="ln">Transcript line</label><input id="ln" value={line} onChange={(e) => setLine(e.target.value)} placeholder="বাংলা, English, or mixed" className="min-w-0 flex-1 rounded border p-2 text-sm" maxLength={4000} />
            <button className="rounded border px-3 py-2 text-sm">Add line</button></form>)}
      </section>

      <section aria-labelledby="note"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="note" className="font-medium">Clinical note <span className="text-sm font-normal text-slate-500">· {approved ? "approved" : "draft"} · v{version}</span></h2>
        <button onClick={loadVersions} className="text-sm underline">version history</button></div>
        {restorable && <p className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm">Unsaved text from a previous session was found. <button className="underline" onClick={() => { const d = JSON.parse(restorable); setTexts(d.texts); setVitals(d.vitals); setDx(d.dx); setRestorable(null); }}>Restore it</button> · <button className="underline" onClick={() => { try { localStorage.removeItem(draftKey); } catch {} setRestorable(null); }}>Discard</button></p>}
        {versions && <ul className="mt-2 rounded border p-2 text-sm">{versions.map((v) => <li key={v.version}>v{v.version} · {v.kind} · {v.authorName} · {new Date(v.createdAt).toLocaleString()}{v.summary ? ` · “${v.summary}”` : ""}</li>)}</ul>}
        <div className="mt-3 space-y-3">{SECTION_KEYS.map((k: SectionKey) => (
          <div key={k}><label htmlFor={`s-${k}`} className="flex items-center justify-between text-sm font-medium">{SECTION_LABELS[k]}<span className={`text-xs font-normal ${texts[k]?.trim() ? "text-green-800" : "text-slate-500"}`}>{texts[k]?.trim() ? "documented" : "not documented"}</span></label>
            <textarea id={`s-${k}`} rows={k === "hpi" || k === "plan" ? 4 : 2} maxLength={5000} value={texts[k] ?? ""} onChange={(e) => setTexts((t) => ({ ...t, [k]: e.target.value }))} className={c} placeholder="Leave empty if not assessed — it is recorded as “not documented”, never as normal." /></div>))}</div>
        <fieldset className="mt-4 rounded border p-3"><legend className="px-1 text-sm font-medium">Vital signs</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{VITAL_FIELDS.map(([k, label, unit]) => (
          <label key={k} className="text-xs">{label} ({unit})<input inputMode="decimal" value={vitals[k]} onChange={(e) => setVitals((v) => ({ ...v, [k]: e.target.value }))} className={`${c} mt-1`} /></label>))}</div></fieldset>
        {warnings.length > 0 && <ul aria-label="Vital sign review flags" className="mt-2 list-disc rounded border border-amber-400 bg-amber-50 p-3 pl-6 text-sm">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        <fieldset className="mt-4 rounded border p-3"><legend className="px-1 text-sm font-medium">Diagnoses</legend>
          {dx.map((d, i) => (<div key={i} className="mb-2 flex gap-2"><input aria-label="Diagnosis" value={d.text} onChange={(e) => setDx((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} className={c} />
            <select aria-label="Diagnosis status" value={d.status} onChange={(e) => setDx((x) => x.map((y, j) => (j === i ? { ...y, status: e.target.value } : y)))} className="rounded border p-2 text-sm"><option value="provisional">Provisional</option><option value="confirmed">Confirmed by me</option></select>
            <button type="button" onClick={() => setDx((x) => x.filter((_, j) => j !== i))} className="text-sm underline">remove</button></div>))}
          <button type="button" onClick={() => setDx((x) => [...x, { text: "", status: "provisional" }])} className="rounded border px-2 py-1 text-sm">Add diagnosis</button>
          <p className="mt-2 text-xs text-slate-500">A diagnosis becomes “confirmed” only when you choose it. Nothing is confirmed automatically.</p></fieldset>
        {approved && <label className="mt-4 block text-sm">Amendment reason (required to change an approved note)<input value={amend} onChange={(e) => setAmend(e.target.value)} className={`${c} mt-1`} minLength={10} maxLength={500} /></label>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={save} disabled={busy || (approved && amend.trim().length < 10)} className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Saving…" : approved ? "Save amendment" : "Save draft"}</button>
          {!approved && version > 0 && <button onClick={approve} className="rounded border px-4 py-2 text-sm font-medium">Approve note</button>}
          {!p.completed && <button onClick={complete} className="rounded border border-slate-900 px-4 py-2 text-sm font-medium">Complete consultation</button>}
        </div>
      </section>
    </div>
  );
}
