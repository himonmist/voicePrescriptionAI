"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Dup { id: string; patientCode: string; fullNameNorm: string; dob: string; level: string; reasons: string[] }

export function NewPatientForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dups, setDups] = useState<Dup[]>([]);
  const [form, setForm] = useState<HTMLFormElement | null>(null);

  async function submit(f: HTMLFormElement, confirm: boolean) {
    setBusy(true); setError(undefined);
    const d = Object.fromEntries(new FormData(f).entries()) as Record<string, string>;
    const payload: Record<string, unknown> = { fullName: d.fullName, dob: d.dob, sex: d.sex, confirmNotDuplicate: confirm };
    for (const k of ["phone", "email", "address"]) if (d[k]) payload[k] = d[k];
    if (d.ecName && d.ecPhone) payload.emergencyContact = { name: d.ecName, phone: d.ecPhone, relation: d.ecRelation || undefined };
    const r = await fetch("/api/patients", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.status === 201) return router.push(`/doctor/patients/${j.patientId}`);
    if (r.status === 409) { setDups(j.duplicates ?? []); return; }
    setError(j.error ?? "Could not save patient");
  }
  const c = "mt-1 w-full rounded border p-2";
  return (
    <form onSubmit={(e) => { e.preventDefault(); setForm(e.currentTarget); setDups([]); submit(e.currentTarget, false); }} className="mt-6 space-y-4">
      <label className="block text-sm">Full name<input name="fullName" required minLength={2} className={c} /></label>
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm">Date of birth<input name="dob" type="date" required max={new Date().toISOString().slice(0, 10)} className={c} /></label>
        <label className="block text-sm">Sex<select name="sex" required defaultValue="" className={c}><option value="" disabled>Select</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option><option value="unknown">Unknown</option></select></label>
      </div>
      <label className="block text-sm">Mobile<input name="phone" inputMode="tel" placeholder="01XXXXXXXXX" className={c} /></label>
      <label className="block text-sm">Email<input name="email" type="email" className={c} /></label>
      <label className="block text-sm">Address<input name="address" className={c} /></label>
      <fieldset className="rounded border p-3"><legend className="px-1 text-sm">Emergency contact (optional)</legend>
        <div className="grid grid-cols-3 gap-2"><input name="ecName" aria-label="Contact name" placeholder="Name" className="rounded border p-2" /><input name="ecPhone" aria-label="Contact mobile" placeholder="Mobile" className="rounded border p-2" /><input name="ecRelation" aria-label="Relation" placeholder="Relation" className="rounded border p-2" /></div>
      </fieldset>
      {dups.length > 0 && (
        <div role="alert" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Possible existing patient — check before creating a new record.</p>
          <ul className="mt-2 space-y-1">{dups.map((d) => <li key={d.id}><a className="underline" href={`/doctor/patients/${d.id}`}>{d.patientCode}</a> · <span className="capitalize">{d.level} match</span> ({d.reasons.join(", ")}) · DOB {d.dob}</li>)}</ul>
          <button type="button" disabled={busy} onClick={() => form && submit(form, true)} className="mt-3 rounded border border-amber-600 px-3 py-1">This is a different person — create anyway</button>
        </div>)}
      {error && <p role="alert" className="text-sm text-red-700">Error: {error}</p>}
      <button disabled={busy} className="rounded bg-[var(--brand)] px-4 py-2 font-medium text-white disabled:opacity-60">{busy ? "Saving…" : "Register patient"}</button>
    </form>
  );
}
