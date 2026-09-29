"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DrugImportForm() {
  const router = useRouter(); const [msg, setMsg] = useState<{ ok: boolean; text: string }>(); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setMsg(undefined);
    let body: unknown; try { body = JSON.parse(String(new FormData(e.currentTarget).get("json"))); } catch { return setMsg({ ok: false, text: "That is not valid JSON." }); }
    setBusy(true);
    const r = await fetch("/api/admin/drug-reference/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: `Imported ${j.drugCount} drugs and ${j.interactionCount} interactions.` }); router.refresh(); } else setMsg({ ok: false, text: j.error ?? "Import failed" });
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">Import JSON<textarea name="json" rows={10} required className="mt-1 w-full rounded border p-2 font-mono text-xs" placeholder={'{ "source": { "name": "…", "version": "…", "publishedAt": "YYYY-MM-DD", "licenceNote": "…" }, "drugs": [ … ], "interactions": [ … ] }'} /></label>
      <button disabled={busy} className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{busy ? "Importing…" : "Import"}</button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.ok ? msg.text : `Error: ${msg.text}`}</p>}
    </form>
  );
}
