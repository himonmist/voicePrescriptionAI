import { L, ageYears, type Lang } from "@/lib/rx-labels";
import type { PrescriptionContent } from "@/server/prescriptions/content";

export interface SheetData {
  code: string; state: "valid" | "superseded" | "cancelled"; issuedAt: string; content: PrescriptionContent;
  doctor: { name: string; bmdc: string; specialty: string; chamberAddress: string | null };
  patient: { name: string; dob: string; sex: string; patientCode: string };
}
const fmtDate = (iso: string) => new Date(new Date(iso).getTime() + 6 * 3600_000).toISOString().slice(0, 10);

/** A4 prescription. Server component: renders the SEALED content only. Print with the browser (Ctrl/Cmd+P). */
export function PrescriptionSheet({ data, lang, verifyUrl, qr }: { data: SheetData; lang: Lang; verifyUrl: string; qr: string }) {
  const t = L[lang], c = data.content;
  const dur = (d: (typeof c.items)[number]["duration"]) => (!d ? "" : "ongoing" in d ? t.ongoing : `${d.value} ${t[d.unit]}`);
  const vit = c.vitals ? Object.entries({ "BP": c.vitals.bpSystolic !== undefined ? `${c.vitals.bpSystolic}/${c.vitals.bpDiastolic ?? "?"} mmHg` : null, Pulse: c.vitals.pulse ? `${c.vitals.pulse}/min` : null, Temp: c.vitals.tempC ? `${c.vitals.tempC} °C` : null, SpO2: c.vitals.spo2 ? `${c.vitals.spo2}%` : null, RR: c.vitals.respRate ? `${c.vitals.respRate}/min` : null, Wt: c.vitals.weightKg ? `${c.vitals.weightKg} kg` : null, Ht: c.vitals.heightCm ? `${c.vitals.heightCm} cm` : null }).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(" · ") : "";
  return (
    <article lang={lang === "bn" ? "bn" : "en"} className="rx-sheet relative mx-auto bg-white p-8 text-[13px] leading-snug text-black" style={{ width: "210mm", minHeight: "297mm", fontFamily: '"Noto Sans Bengali", "Noto Sans", system-ui, sans-serif' }}>
      {data.state !== "valid" && <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-6xl font-black opacity-15" style={{ transform: "rotate(-30deg)" }}>{data.state === "superseded" ? "SUPERSEDED" : "CANCELLED"}</div>}
      {data.state !== "valid" && <p role="alert" className="mb-3 border-2 border-black p-2 text-center font-bold">{data.state === "superseded" ? t.superseded : t.cancelled}</p>}
      <header className="flex items-start justify-between border-b-2 border-black pb-2">
        <div><h1 className="text-lg font-bold">{data.doctor.name}</h1><p>{data.doctor.specialty}</p><p>{t.reg}: {data.doctor.bmdc}</p>{data.doctor.chamberAddress && <p>{data.doctor.chamberAddress}</p>}</div>
        <div className="text-right"><p className="text-xl font-bold">℞ {t.rx}</p><p>{t.id}: <strong>{data.code}</strong></p><p>{t.date}: {fmtDate(data.issuedAt)}</p></div>
      </header>
      <section className="mt-2 grid grid-cols-2 gap-x-6 border-b pb-2">
        <p>{t.patient}: <strong>{data.patient.name}</strong></p><p>{t.patientId}: {data.patient.patientCode}</p>
        <p>{t.age}: {ageYears(data.patient.dob, data.issuedAt)} y · {t.sex}: {t[data.patient.sex] ?? t.unknown}</p>
      </section>
      <section className="mt-2"><p><strong>{t.allergies}:</strong> {c.allergiesSnapshot.length ? c.allergiesSnapshot.join("; ") : t.none}</p>
        {c.chiefComplaint && <p><strong>{t.complaint}:</strong> {c.chiefComplaint}</p>}{c.history && <p><strong>{t.history}:</strong> {c.history}</p>}{vit && <p><strong>{t.vitals}:</strong> {vit}</p>}
        {c.diagnoses.length > 0 && <p><strong>{t.diagnosis}:</strong> {c.diagnoses.map((d) => `${d.text} (${d.status === "confirmed" ? t.confirmed : t.provisional})`).join("; ")}</p>}</section>
      {c.items.length > 0 && (
        <table className="mt-3 w-full border-collapse"><caption className="mb-1 text-left font-bold">{t.medicines}</caption>
          <thead><tr className="border-y border-black text-left"><th className="w-6 py-1">#</th><th>{t.drug}</th><th>{t.dose}</th><th>{t.frequency}</th><th>{t.duration}</th><th>{t.instructions}</th></tr></thead>
          <tbody>{c.items.map((it, i) => (
            <tr key={i} className="border-b align-top"><td className="py-1">{i + 1}</td>
              <td><strong>{it.genericName}</strong>{it.brandName ? ` (${it.brandName})` : ""}<br />{[it.strength, it.dosageForm, it.route].filter(Boolean).join(" · ")}</td>
              <td>{it.dose}</td><td>{it.frequency}</td><td>{dur(it.duration)}</td>
              <td>{[it.timing, it.quantity ? `Qty ${it.quantity}` : null, it.refills != null ? `Refills ${it.refills}` : null, it.warnings, it.comments].filter(Boolean).join(" · ")}</td></tr>))}</tbody></table>)}
      {c.investigations.length > 0 && <section className="mt-3"><p className="font-bold">{t.investigations}</p><ul className="list-disc pl-5">{c.investigations.map((x, i) => <li key={i}>{x}</li>)}</ul></section>}
      {c.advice && <section className="mt-3"><p className="font-bold">{t.advice}</p><p className="whitespace-pre-line">{c.advice}</p></section>}
      {c.followUp && (c.followUp.date || c.followUp.text) && <p className="mt-3"><strong>{t.followUp}:</strong> {[c.followUp.date, c.followUp.text].filter(Boolean).join(" — ")}</p>}
      {c.referral && (c.referral.to || c.referral.reason) && <p className="mt-1"><strong>{t.referral}:</strong> {[c.referral.to, c.referral.reason].filter(Boolean).join(" — ")}</p>}
      <footer className="absolute bottom-8 left-8 right-8 flex items-end justify-between border-t-2 border-black pt-2">
        <div className="max-w-[70%]"><p className="font-bold">{t.signed}</p><p>{data.doctor.name} · {t.reg} {data.doctor.bmdc}</p><p className="break-all text-[11px]">{t.verify}: {verifyUrl}</p><p className="mt-1 text-[10px]">{t.notes}</p></div>
        <div aria-label="QR code" className="h-24 w-24 shrink-0" dangerouslySetInnerHTML={{ __html: qr }} />
      </footer>
    </article>
  );
}
