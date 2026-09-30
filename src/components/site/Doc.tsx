export function Doc({ title, lead, children, draft }: { title: string; lead?: string; children: React.ReactNode; draft?: boolean }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold">{title}</h1>
      {lead && <p className="mt-3 text-lg text-slate-600">{lead}</p>}
      {draft && <p role="note" className="mt-4 rounded border-2 border-amber-600 bg-amber-50 p-3 text-sm">Draft for legal review. This text is a starting point and must be reviewed by a qualified lawyer before real patients or doctors are onboarded.</p>}
      <div className="mt-8 space-y-6 leading-relaxed [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_a]:text-[var(--brand)] [&_a]:underline [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">{children}</div>
    </article>
  );
}
