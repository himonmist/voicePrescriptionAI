"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SubmitVerification() {
  const router = useRouter(); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setMsg(undefined);
    const r = await fetch("/api/doctor/verification/submit", { method: "POST" });
    setBusy(false);
    if (r.ok) router.refresh(); else setMsg((await r.json().catch(() => ({}))).error ?? "Failed");
  }
  return (<div><button onClick={go} disabled={busy} className="rounded bg-[var(--brand)] px-4 py-2 font-medium text-white disabled:opacity-60">{busy ? "Submitting…" : "Submit for verification"}</button>{msg && <p role="alert" className="mt-2 text-sm text-red-700">Error: {msg}</p>}</div>);
}
