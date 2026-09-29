export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Log in</h1>
      {error && <p role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error === "mfa" ? "Enter your 6-digit verification code." : "Invalid email or password."}</p>}
      <form method="post" action="/api/auth/login" className="mt-6 space-y-4">
        <label className="block text-sm">Email<input name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm">Password<input name="password" type="password" required autoComplete="current-password" className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm">Verification code (if enabled)<input name="totp" inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" className="mt-1 w-full rounded border p-2" /></label>
        <details className="text-sm"><summary className="cursor-pointer">Lost your device? Use a recovery code</summary><label className="mt-2 block">Recovery code<input name="recoveryCode" placeholder="xxxxx-xxxxx" className="mt-1 w-full rounded border p-2" /></label></details>
        <button className="w-full rounded bg-[var(--brand)] p-2 font-medium text-white">Log in</button>
      </form>
      <p className="mt-4 text-sm">New here? <a className="underline" href="/register/patient">Patient sign-up</a> · <a className="underline" href="/register/doctor">Doctor sign-up</a></p>
    </main>
  );
}
