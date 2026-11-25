import type { ReactNode } from "react";
import Link from "next/link";
import { SolveKeyLogo } from "./SolveKeyLogo";

interface AuthPageFrameProps {
  eyebrow: string;
  meta: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}

/** Shared auth layout: a quiet form surface paired with SolveKey's civic purpose. */
export function AuthPageFrame({ eyebrow, meta, title, description, children, footer }: AuthPageFrameProps) {
  return (
    <main className="min-h-dvh bg-[#EEF3F8] dark:bg-[#07162F]">
      <div className="mx-auto grid min-h-dvh w-full max-w-[1440px] lg:grid-cols-[minmax(0,1.12fr)_minmax(430px,0.88fr)]">
        <aside className="relative hidden overflow-hidden bg-[#092553] p-10 text-white lg:flex lg:min-h-dvh lg:flex-col lg:justify-between lg:p-12 xl:p-16">
          <div className="absolute -right-24 -top-24 size-80 rounded-full border border-white/10" aria-hidden="true" />
          <div className="absolute -right-12 -top-12 size-56 rounded-full border border-[#05D7E5]/20" aria-hidden="true" />
          <Link href="/map" className="relative inline-flex w-fit rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#05D7E5]">
            <SolveKeyLogo theme="dark" size="md" showTagline={false} />
          </Link>

          <div className="relative max-w-xl py-12">
            <p className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#A9E9EC]">
              <span className="size-2 rounded-full bg-[#0BD58A]" /> Civic services, connected
            </p>
            <h2 className="max-w-lg text-3xl font-semibold leading-[1.12] tracking-[-0.035em] xl:text-4xl">
              Better cities begin with a clearer way to be heard.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-blue-100/85">
              SolveKey brings residents and city teams together to report local issues, follow progress, and move practical solutions forward.
            </p>

            <ol className="mt-9 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {[
                ["01", "Report clearly"],
                ["02", "Follow progress"],
                ["03", "Improve together"],
              ].map(([step, label]) => (
                <li key={step} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#0BD58A] text-xs font-bold text-[#012667]">{step}</span>
                  <span className="text-sm font-medium text-blue-50">{label}</span>
                </li>
              ))}
            </ol>
          </div>

          <p className="relative text-xs text-blue-100/65">A more responsive city starts with local insight.</p>
        </aside>

        <div className="flex min-w-0 items-center justify-center px-5 py-8 sm:px-10 lg:px-12 lg:py-12">
          <div className="w-full max-w-[430px]">
            <div className="mb-7 flex justify-center lg:hidden">
              <Link href="/map" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#05D7E5]">
                <SolveKeyLogo size="md" showTagline={false} />
              </Link>
            </div>

            <section className="rounded-[18px] border border-slate-200/80 bg-white px-6 py-7 shadow-[0_18px_50px_-32px_rgba(9,37,83,0.38)] dark:border-slate-800 dark:bg-[#0D203F] sm:px-9 sm:py-9">
              <div className="mb-5 flex items-center justify-between gap-3">
                <span className="rounded-md bg-[#E7F9FB] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[#075B67] dark:bg-[#103553] dark:text-[#A9E9EC]">
                  {eyebrow}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{meta}</span>
              </div>

              <h1 className="text-[length:var(--font-section)] font-semibold tracking-[-0.025em] text-[#012667] dark:text-white sm:text-3xl">
                {title}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>

              <div className="mt-7">{children}</div>
              {footer}
            </section>

            <p className="mt-5 text-center text-xs tracking-wide text-slate-500 dark:text-slate-400">
              SolveKey <span className="mx-1 text-[#04A077]">/</span> Report · Resolve · Improve
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
