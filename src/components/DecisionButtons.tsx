"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const NEXT: Record<string, { to: string; label: string; needsNotes?: boolean }[]> = {
  verification_pending: [{ to: "under_review", label: "Start review" }],
  under_review: [{ to: "approved", label: "Approve" }, { to: "rejected", label: "Reject", needsNotes: true }],
  approved: [{ to: "active", label: "Activate" }],
  active: [{ to: "suspended", label: "Suspend", needsNotes: true }],
  suspended: [{ to: "active", label: "Reactivate" }],
};

export function DecisionButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const actions = NEXT[status] ?? [];
  if (!actions.length) return <span className="text-sm text-slate-500">No action</span>;
  async function go(to: string, needsNotes?: boolean) {
    const notes = needsNotes ? window.prompt("Reason (required, recorded in audit trail):")?.trim() : undefined;
    if (needsNotes && !notes) return;
    setBusy(true); setMsg(undefined);
    const r = await fetch(`/api/admin/doctors/${id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to, notes }) });
    setBusy(false);
    if (r.ok) router.refresh(); else setMsg((await r.json().catch(() => ({}))).error ?? "Failed");
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((a) => <button key={a.to} disabled={busy} onClick={() => go(a.to, a.needsNotes)} className="rounded border px-2 py-1 text-sm disabled:opacity-50">{a.label}</button>)}
      {msg && <span role="alert" className="text-sm text-red-700">Error: {msg}</span>}
    </div>
  );
}
