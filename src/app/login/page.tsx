export default function LoginPage() {
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <form method="post" action="/api/auth/login" className="mt-6 space-y-4">
        <label className="block text-sm">Email<input name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm">Password<input name="password" type="password" required autoComplete="current-password" className="mt-1 w-full rounded border p-2" /></label>
        <button className="w-full rounded bg-[var(--brand)] p-2 font-medium text-white">Log in</button>
      </form>
    </main>
  );
}
