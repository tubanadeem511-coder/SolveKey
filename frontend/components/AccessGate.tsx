import Link from "next/link";
import { SolveKeyGlyph } from "./SolveKeyLogo";

interface AccessGateProps {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  actionHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}

/** Clear, consistent sign-in prompt for account-protected SolveKey features. */
export function AccessGate({
  eyebrow,
  title,
  description,
  actionLabel,
  actionHref = "/login",
  secondaryLabel,
  secondaryHref,
}: AccessGateProps) {
  return (
    <section className="mx-auto grid max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_28px_-22px_rgba(1,38,103,0.32)] dark:border-slate-800 dark:bg-[#012667] md:grid-cols-[104px_minmax(0,1fr)] lg:grid-cols-[112px_minmax(0,1fr)_auto]">
      <div className="flex items-center justify-center border-b border-slate-100 bg-[#F1F7FB] px-5 py-4 dark:border-slate-800 dark:bg-[#103553] md:border-b-0 md:border-r">
        <SolveKeyGlyph className="size-12" />
      </div>
      <div className="min-w-0 px-5 py-5 sm:px-7 sm:py-6">
        <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.15em] text-[#075B67] dark:text-[#A9E9EC]">
          <span className="size-1.5 rounded-full bg-[#05D7E5]" />{eyebrow}
        </p>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-[#012667] dark:text-white sm:text-2xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800 md:col-start-2 md:px-7 lg:col-start-auto lg:border-l lg:border-t-0">
        <Link href={actionHref} className="sk-primary-action inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2.5 text-sm transition">
          {actionLabel}
        </Link>
        {secondaryLabel && secondaryHref && (
          <Link href={secondaryHref} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-[#012667] transition hover:border-[#7CB3DD] hover:bg-[#F1F7FB] dark:border-slate-700 dark:text-slate-100 dark:hover:bg-[#103553]">
            {secondaryLabel}
          </Link>
        )}
      </div>
    </section>
  );
}
