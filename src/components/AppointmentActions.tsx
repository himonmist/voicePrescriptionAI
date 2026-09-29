"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

async function post(url: string, body?: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.ok ? null : (((await r.json().catch(() => ({}))).error as string) ?? "Failed");
}

export function AppointmentActions({ id, status, role }: { id: string; status: string; role: "patient" | "doctor" | "reception" }) {
  const router = useRouter(); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<string | null>) { setBusy(true); setErr(undefined); const e = await fn(); setBusy(false); if (e) setErr(e); else router.refresh(); }
  const setTo = (to: string) => run(() => post(`/api/appointments/${id}/status`, { to }));
  const cancel = () => run(async () => {
    let reason: string | undefined;
    if (role !== "patient") { reason = window.prompt("Reason for cancelling (the patient is notified):")?.trim(); if (!reason) return null; }
    else if (!window.confirm("Cancel this appointment?")) return null;
    return post(`/api/appointments/${id}/cancel`, { reason });
  });
  const b = "rounded border px-2 py-1 text-sm disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {role !== "patient" && status === "booked" && <button className={b} disabled={busy} onClick={() => setTo("checked_in")}>Check in</button>}
      {role === "doctor" && status === "checked_in" && <button className={b} disabled={busy} onClick={() => setTo("in_progress")}>Start</button>}
      {role === "doctor" && status === "in_progress" && <button className={b} disabled={busy} onClick={() => setTo("completed")}>Complete</button>}
      {role !== "patient" && (status === "booked" || status === "checked_in") && <button className={b} disabled={busy} onClick={() => setTo("no_show")}>No-show</button>}
      {(status === "booked" || status === "checked_in") && <button className={b} disabled={busy} onClick={cancel}>Cancel</button>}
      {err && <span role="alert" className="text-sm text-red-700">Error: {err}</span>}
    </div>
  );
}
