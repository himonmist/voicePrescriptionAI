import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <p className="text-sm font-medium text-[var(--teal)]">SmartDoctorAid</p>
      <h1 className="mt-3 text-4xl font-semibold leading-tight">AI দিয়ে প্রেসক্রিপশন তৈরি করুন</h1>
      <h2 className="mt-2 text-2xl text-slate-700">Turn Doctor-Patient Conversations into Structured Clinical Documentation.</h2>
      <p className="mt-4 max-w-2xl text-slate-600">
        SmartDoctorAid helps doctors prepare prescription drafts, clinical notes, and medical summaries using AI-powered voice documentation in Bangla, English, and mixed-language consultations. The treating doctor reviews, edits and signs every prescription.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/register/doctor" className="rounded-md bg-[var(--brand)] px-5 py-3 font-medium text-white">Start Free Trial</Link>
        <Link href="/login" className="rounded-md border border-slate-300 px-5 py-3 font-medium">Log in</Link>
      </div>
    </main>
  );
}
