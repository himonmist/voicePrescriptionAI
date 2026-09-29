"use client";
import { useState } from "react";

export interface ProfileValues { consultationFeeBdt: number | null; bio: string | null; languages: string[]; chamberAddress: string | null; consultationMode: string; publicProfile: boolean; status: string }

export function DoctorProfileForm({ initial }: { initial: ProfileValues }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>(); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg(undefined);
    const f = new FormData(e.currentTarget);
    const body = { consultationFeeBdt: f.get("fee") ? Number(f.get("fee")) : undefined, bio: String(f.get("bio") ?? ""), languages: String(f.get("languages") ?? "").split(",").map((s) => s.trim()).filter(Boolean), chamberAddress: String(f.get("address") ?? ""), consultationMode: String(f.get("mode")), publicProfile: f.get("public") === "on" };
    const r = await fetch("/api/doctor/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false); setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: (await r.json().catch(() => ({}))).error ?? "Failed" });
  }
  const c = "mt-1 w-full rounded border p-2";
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm">Consultation fee (BDT)<input name="fee" type="number" min={0} defaultValue={initial.consultationFeeBdt ?? ""} className={c} /></label>
      <label className="block text-sm">Biography<textarea name="bio" rows={4} maxLength={1500} defaultValue={initial.bio ?? ""} className={c} /></label>
      <label className="block text-sm">Languages (comma separated)<input name="languages" defaultValue={initial.languages.join(", ")} className={c} /></label>
      <label className="block text-sm">Chamber address<input name="address" defaultValue={initial.chamberAddress ?? ""} className={c} /></label>
      <label className="block text-sm">Consultation mode<select name="mode" defaultValue={initial.consultationMode} className={c}><option value="both">In person & online</option><option value="in_person">In person only</option><option value="online">Online only</option></select></label>
      <label className="flex items-start gap-2 text-sm"><input name="public" type="checkbox" defaultChecked={initial.publicProfile} className="mt-1" /><span>List me in the public doctor directory{initial.status !== "active" && <em className="block text-slate-500">Takes effect only after your account is verified and active (currently: {initial.status.replace("_", " ")}).</em>}</span></label>
      <button disabled={busy} className="rounded bg-[var(--brand)] px-4 py-2 font-medium text-white disabled:opacity-60">{busy ? "Saving…" : "Save profile"}</button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.ok ? msg.text : `Error: ${msg.text}`}</p>}
    </form>
  );
}
