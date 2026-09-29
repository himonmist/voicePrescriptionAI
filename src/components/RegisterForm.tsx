"use client";
import { useState } from "react";

export function RegisterForm({ type }: { type: "doctor" | "patient" }) {
  const [state, setState] = useState<{ kind: "idle" | "loading" | "ok" | "error"; msg?: string }>({ kind: "idle" });
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "loading" });
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch(`/api/auth/register?type=${type}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const j = await res.json().catch(() => ({}));
    setState(res.ok ? { kind: "ok" } : { kind: "error", msg: j.error ?? "Registration failed" });
  }
  const f = "mt-1 w-full rounded border p-2";
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <label className="block text-sm">Full name<input name="fullName" required className={f} /></label>
      <label className="block text-sm">Email<input name="email" type="email" required autoComplete="email" className={f} /></label>
      <label className="block text-sm">Mobile (Bangladesh)<input name="phone" required inputMode="tel" placeholder="01XXXXXXXXX" className={f} /></label>
      {type === "doctor" && (<>
        <label className="block text-sm">BMDC registration number<input name="bmdcNumber" required className={f} /></label>
        <label className="block text-sm">Specialty<input name="specialty" required className={f} /></label>
      </>)}
      <label className="block text-sm">Password (12+ characters)<input name="password" type="password" required autoComplete="new-password" className={f} /></label>
      <button disabled={state.kind === "loading"} className="w-full rounded bg-[var(--brand)] p-2 font-medium text-white disabled:opacity-60">{state.kind === "loading" ? "Creating…" : "Create account"}</button>
      <p role="status" aria-live="polite" className="text-sm">
        {state.kind === "error" && <span className="text-red-700">Error: {state.msg}</span>}
        {state.kind === "ok" && <span className="text-green-800">Account created.{type === "doctor" ? " Your registration is pending verification; you cannot practise on the platform until approved." : ""} <a className="underline" href="/login">Log in</a></span>}
      </p>
    </form>
  );
}
