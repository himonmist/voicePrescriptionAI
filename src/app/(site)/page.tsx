import Link from "next/link";

const STEPS = [
  ["Talk", "Consult as usual in Bangla, English or a mix. With the patient's recorded consent, the conversation is transcribed.", "কথা বলুন"],
  ["Review", "AI proposes a structured note and prescription draft. Anything unclear is flagged; missing information stays missing.", "যাচাই করুন"],
  ["Sign", "You edit, approve and sign with your password. Only then is a sealed, verifiable prescription issued.", "স্বাক্ষর করুন"],
] as const;

const FEATURES = [
  ["Bangla + English voice notes", "Transcripts keep the original wording; uncertain lines are flagged, never silently “fixed”."],
  ["Structured clinical notes", "Fifteen sections, each either documented or explicitly “not documented”. Every version is kept."],
  ["Safer prescribing", "Duplicate-ingredient, allergy and interaction checks from authorized reference data you load — with a clear list of what was not checked."],
  ["Verifiable prescriptions", "QR code and public verification page confirm the issuer and that nothing changed since signing. No patient data is shown."],
  ["Appointments & queue", "Weekly schedule, holidays, no double-booking, day-of check-in and walk-ins."],
  ["Private by design", "Encrypted patient data, role-based access, MFA for staff, and an audit trail that never stores clinical text."],
] as const;

const TRUST = ["The AI never signs or finalizes anything", "Finalized prescriptions cannot be edited — corrections create a linked, reasoned amendment", "Recording only with recorded patient consent, and it stops the moment consent is withdrawn", "No drug data is invented: screening uses only reference data from an authorized source", "Share links expire, can be revoked, and need the patient's date of birth"];

export default function Home() {
  return (
    <>
      <section className="bg-gradient-to-b from-sky-50 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="text-sm font-medium text-[var(--teal)]">For doctors in Bangladesh</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">Less typing. <br />More time with patients.</h1>
            <p lang="bn" className="mt-3 text-xl text-slate-700">AI দিয়ে প্রেসক্রিপশন ও নোট তৈরি করুন — চূড়ান্ত সিদ্ধান্ত ও স্বাক্ষর ডাক্তারের।</p>
            <p className="mt-4 max-w-xl text-slate-600">Turn doctor-patient conversations into structured clinical notes and prescription drafts. You stay in control: you review, edit and sign every document.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register/doctor" className="rounded-md bg-[var(--brand)] px-5 py-3 font-medium text-white shadow-sm">Start free trial</Link>
              <Link href="/how-it-works" className="rounded-md border border-slate-300 bg-white px-5 py-3 font-medium">See how it works</Link>
            </div>
            <p className="mt-3 text-xs text-slate-500">Doctors are verified against their BMDC registration before going live.</p>
          </div>
          <div aria-hidden className="relative mx-auto w-full max-w-md">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
              <div className="flex items-center justify-between border-b pb-3"><div><p className="text-sm font-semibold">Dr. Example Name</p><p className="text-xs text-slate-500">General Practice · BMDC A-00000</p></div><span className="text-2xl font-bold text-[var(--brand)]">℞</span></div>
              <div className="mt-3 space-y-2 text-sm"><p className="text-xs uppercase tracking-wide text-slate-500">Draft — awaiting doctor review</p>
                <div className="rounded-lg bg-slate-50 p-3"><p className="font-medium">Sample medicine 500 mg tablet</p><p className="text-slate-600">1 tablet · twice daily · 5 days</p></div>
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">⚠ Needs your decision: dose not stated in the conversation</div></div>
              <div className="mt-4 flex items-center justify-between"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs">Sample layout, not a real prescription</span><span className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">Approve &amp; sign</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16" aria-labelledby="how">
        <h2 id="how" className="text-3xl font-semibold">Three steps. You decide at every one.</h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">{STEPS.map(([t, d, bn], i) => (
          <li key={t} className="rounded-xl border border-slate-200 bg-white p-6"><span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--brand)] font-semibold text-white">{i + 1}</span><h3 className="mt-4 text-lg font-semibold">{t} <span lang="bn" className="ml-1 text-sm font-normal text-slate-500">{bn}</span></h3><p className="mt-2 text-slate-600">{d}</p></li>))}</ol>
      </section>

      <section className="bg-slate-50" aria-labelledby="feat">
        <div className="mx-auto max-w-6xl px-4 py-16"><h2 id="feat" className="text-3xl font-semibold">Everything a clinic needs, nothing hidden</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{FEATURES.map(([t, d]) => <div key={t} className="rounded-xl border border-slate-200 bg-white p-6"><h3 className="font-semibold">{t}</h3><p className="mt-2 text-sm text-slate-600">{d}</p></div>)}</div>
          <p className="mt-6"><Link href="/features" className="text-[var(--brand)] underline">All features →</Link></p></div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16" aria-labelledby="trust">
        <div className="grid gap-8 md:grid-cols-2"><div><h2 id="trust" className="text-3xl font-semibold">Built around clinical safety</h2><p className="mt-3 text-slate-600">These are rules the software enforces, not promises. See the full list in our <Link className="underline" href="/how-it-works#safety">safety principles</Link>.</p></div>
          <ul className="space-y-3">{TRUST.map((t) => <li key={t} className="flex gap-3"><span aria-hidden className="mt-1 text-[var(--teal)]">✔</span><span>{t}</span></li>)}</ul></div>
      </section>

      <section className="bg-[var(--brand)] text-white"><div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-12 md:flex-row md:items-center"><div><h2 className="text-2xl font-semibold">Ready to spend less time on paperwork?</h2><p className="mt-1 text-sky-100">Free trial for verified doctors. Patients can find verified doctors and book online.</p></div><div className="flex gap-3"><Link href="/register/doctor" className="rounded-md bg-white px-5 py-3 font-medium text-[var(--brand)]">Start free trial</Link><Link href="/doctors" className="rounded-md border border-white/60 px-5 py-3 font-medium">Find a doctor</Link></div></div></section>
    </>
  );
}
