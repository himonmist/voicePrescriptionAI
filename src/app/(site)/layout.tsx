import Link from "next/link";

const NAV = [["Features", "/features"], ["How it works", "/how-it-works"], ["Find a doctor", "/doctors"], ["Pricing", "/pricing"], ["FAQ", "/faq"]] as const;

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-white focus:p-2">Skip to content</a>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold"><span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--brand)] text-white">℞</span>SmartDoctorAid</Link>
          <nav aria-label="Main" className="hidden gap-6 text-sm text-slate-700 md:flex">{NAV.map(([l, h]) => <Link key={h} href={h} className="hover:text-[var(--brand)]">{l}</Link>)}</nav>
          <div className="flex items-center gap-2 text-sm"><Link href="/login" className="rounded-md px-3 py-2 hover:bg-slate-100">Log in</Link><Link href="/register/doctor" className="rounded-md bg-[var(--brand)] px-3 py-2 font-medium text-white">Start free trial</Link></div>
        </div>
        <nav aria-label="Main (mobile)" className="flex gap-4 overflow-x-auto border-t px-4 py-2 text-sm text-slate-700 md:hidden">{NAV.map(([l, h]) => <Link key={h} href={h} className="whitespace-nowrap">{l}</Link>)}</nav>
      </header>
      <div id="main" className="flex-1">{children}</div>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-4">
          <div className="sm:col-span-2"><p className="font-semibold">SmartDoctorAid</p><p className="mt-2 max-w-sm text-slate-600">AI-assisted clinical documentation for doctors in Bangladesh. The treating doctor reviews, edits and signs everything. SmartDoctorAid is documentation software, not a substitute for clinical judgement.</p></div>
          <div><p className="font-medium">Product</p><ul className="mt-2 space-y-1 text-slate-600">{NAV.map(([l, h]) => <li key={h}><Link href={h}>{l}</Link></li>)}</ul></div>
          <div><p className="font-medium">Company</p><ul className="mt-2 space-y-1 text-slate-600"><li><Link href="/about">About</Link></li><li><Link href="/contact">Contact</Link></li><li><Link href="/privacy">Privacy</Link></li><li><Link href="/terms">Terms</Link></li></ul></div>
        </div>
        <p className="border-t py-4 text-center text-xs text-slate-500">© {new Date().getFullYear()} SmartDoctorAid</p>
      </footer>
    </div>
  );
}
