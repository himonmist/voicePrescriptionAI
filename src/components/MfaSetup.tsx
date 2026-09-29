"use client";
import { useState } from "react";

type Step = "idle" | "scan" | "codes";
async function post(url: string, body?: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

export function MfaSetup({ enabled, required }: { enabled: boolean; required: boolean }) {
  const [step, setStep] = useState<Step>("idle");
  const [secret, setSecret] = useState(""); const [uri, setUri] = useState("");
  const [codes, setCodes] = useState<string[]>([]); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);

  async function start() { setBusy(true); setErr(undefined); const r = await post("/api/account/mfa/start"); setBusy(false); if (!r.ok) return setErr(r.data.error ?? "Failed"); setSecret(r.data.secret); setUri(r.data.otpauthUri); setStep("scan"); }
  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr(undefined);
    const r = await post("/api/account/mfa/confirm", { code: String(new FormData(e.currentTarget).get("code")) });
    setBusy(false); if (!r.ok) return setErr(r.data.error ?? "Failed"); setCodes(r.data.recoveryCodes); setStep("codes");
  }

  if (step === "codes") return (
    <div role="status">
      <p className="font-medium text-green-800">Two-factor authentication is on. Your sessions were signed out.</p>
      <p className="mt-3 text-sm">Save these recovery codes now — each works once, and they will not be shown again.</p>
      <pre className="mt-2 rounded bg-slate-100 p-3 font-mono text-sm">{codes.join("\n")}</pre>
      <a href="/login" className="mt-4 inline-block rounded bg-[var(--brand)] px-4 py-2 font-medium text-white">Sign in again</a>
    </div>);

  if (enabled) return <p>Two-factor authentication is <strong>enabled</strong>.{required && " It is required for your role and cannot be turned off."}</p>;

  return (
    <div>
      {required && <p role="alert" className="mb-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm">Your role requires two-factor authentication. Set it up to continue — the rest of the admin area is locked until you do.</p>}
      {step === "idle" && <button onClick={start} disabled={busy} className="rounded bg-[var(--brand)] px-4 py-2 font-medium text-white disabled:opacity-60">Set up authenticator app</button>}
      {step === "scan" && (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-sm">In your authenticator app (Google Authenticator, Authy, 1Password…) add an account manually with this key:</p>
          <code className="block break-all rounded bg-slate-100 p-2 text-sm" aria-label="Setup key">{secret}</code>
          <details className="text-xs text-slate-600"><summary>otpauth link</summary><code className="break-all">{uri}</code></details>
          <label className="block text-sm">6-digit code<input name="code" inputMode="numeric" pattern="\d{6}" required autoComplete="one-time-code" className="mt-1 w-40 rounded border p-2" /></label>
          <button disabled={busy} className="rounded bg-[var(--brand)] px-4 py-2 font-medium text-white disabled:opacity-60">Verify and enable</button>
        </form>)}
      {err && <p role="alert" className="mt-3 text-sm text-red-700">Error: {err}</p>}
    </div>);
}
