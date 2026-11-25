export function TabPlaceholder({ title }: { title: string }) {
  return (
    <section className="rounded-3xl border border-emerald-950/5 bg-white p-7 shadow-soft sm:p-10">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#075B67] dark:text-[#05D7E5]">SolveKey Platform</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">{title}</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
        The shared app shell and navigation are ready. This screen will be built in a later step.
      </p>
    </section>
  );
}
