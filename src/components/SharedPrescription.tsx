"use client";
import { useState } from "react";
import { PrescriptionSheet, type SheetData } from "@/components/PrescriptionSheet";
import type { Lang } from "@/lib/rx-labels";

interface Opened { state: "valid" | "superseded" | "cancelled"; copy?: SheetData; lang?: Lang; verifyUrl?: string; qr?: string; pdfAvailable?: boolean }

export function SharedPrescription({ token }: { token: string }) {
  const [dob, setDob] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>(); const [gone, setGone] = useState(false); const [data, setData] = useState<Opened>();
  const base = `/api/public/rx/${encodeURIComponent(token)}`;
  const post = (kind: "open" | "pdf") => fetch(`${base}/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dob }) });

  async function open(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(undefined);
    const r = await post("open"); const j = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) { setData(j); return; }
    if (r.status === 410) setGone(true); else setErr(j.error ?? "Could not open the prescription");
  }
  async function pdf() {
    const r = await post("pdf"); if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "PDF unavailable"); return; }
    const url = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = url; a.download = `${data?.copy?.code ?? "prescription"}.pdf`; a.click(); URL.revokeObjectURL(url);
  }

  if (gone) return <main className="mx-auto max-w-md px-4 py-10"><h1 className="text-xl font-semibold">Link unavailable</h1><p role="alert" className="mt-4 rounded border-2 border-slate-700 p-4">This link is no longer valid. Please ask your doctor for a new one.</p></main>;
  if (data?.state && data.state !== "valid") return <main className="mx-auto max-w-md px-4 py-10"><h1 className="text-xl font-semibold">Prescription {data.state === "superseded" ? "replaced" : "cancelled"}</h1><p role="alert" className="mt-4 rounded border-2 border-amber-700 bg-amber-50 p-4">{data.state === "superseded" ? "This prescription has been amended by your doctor. Please ask them for the current version. Do not use this one." : "This prescription was cancelled by your doctor. Do not use it."}</p></main>;
  if (data?.copy && data.verifyUrl && data.qr && data.lang) {
    return (
      <div className="bg-slate-100 py-6 print:bg-white print:py-0">
        <style>{`@page { size: A4; margin: 0 } @media print { .no-print { display: none !important } .rx-sheet { box-shadow: none !important } }`}</style>
        <nav className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-3 px-2 text-sm">
          <button onClick={() => window.print()} className="rounded border px-3 py-1">Print</button>
          {data.pdfAvailable ? <button onClick={pdf} className="rounded border px-3 py-1">Download PDF</button> : <span className="text-slate-700">To save as PDF, choose “Save as PDF” in the print dialog.</span>}
          {err && <span role="alert" className="text-red-700">{err}</span>}
        </nav>
        <div className="shadow"><PrescriptionSheet data={data.copy} lang={data.lang} verifyUrl={data.verifyUrl} qr={data.qr} /></div>
      </div>
    );
  }
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">Your prescription</h1>
      <p className="mt-2 text-sm text-slate-700">To protect your privacy, confirm your date of birth to view this prescription.</p>
      <form onSubmit={open} className="mt-6 space-y-3">
        <label className="block text-sm">Date of birth<input type="date" required value={dob} onChange={(e) => setDob(e.target.value)} className="mt-1 block w-full rounded border px-3 py-2" autoComplete="bday" /></label>
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{busy ? "Checking…" : "View prescription"}</button>
      </form>
      <p className="mt-6 text-xs text-slate-600">After 5 incorrect attempts this link is locked. Anyone with this link and your date of birth can view the prescription — do not share it publicly.</p>
    </main>
  );
}
