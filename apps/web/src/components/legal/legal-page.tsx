import type { ReactNode } from "react";
import { Container } from "@/components/ui/container.tsx";
import { InfoIcon } from "@/components/ui/icons.tsx";

/** When the drafts were last revised (SPEC §17). Update with every change. */
export const LEGAL_LAST_UPDATED = "October 23, 2026";

type LegalPageProps = { title: string; intro: ReactNode; children: ReactNode };

/**
 * Shared layout for legal and policy pages. Every page is a draft for lawyer review
 * (SPEC §17) and says so at the top.
 */
export function LegalPage({ title, intro, children }: LegalPageProps) {
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <article className="mx-auto max-w-[760px]">
        <header className="rounded-panel bg-season-tint px-4.5 py-8 sm:rounded-hero sm:px-10 sm:py-10">
          <h1 className="font-display text-[32px] leading-[1.08] font-extrabold tracking-[-0.03em] sm:text-[40px]">
            {title}
          </h1>
          <p className="mt-2 text-sm text-muted">Last updated {LEGAL_LAST_UPDATED}</p>
          <p
            role="note"
            className="mt-4 flex items-start gap-2.5 rounded-input border border-border bg-surface px-3.5 py-3 text-[15px] leading-snug"
          >
            <InfoIcon size={18} className="mt-px flex-none text-season-ink" />
            <span>
              <strong>Draft, pending legal review.</strong>{" "}
              <span className="text-muted">
                This page describes how Nevile intends to work at launch and may change before then.
              </span>
            </span>
          </p>
          <div className="mt-4 text-[17px] leading-[1.6]">{intro}</div>
        </header>
        <div className="legal-prose mt-8 grid gap-7 px-1 text-[16px] leading-[1.65] text-ink">
          {children}
        </div>
      </article>
    </Container>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="font-display text-[22px] leading-tight font-bold tracking-[-0.01em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function LegalList({ items }: { items: readonly ReactNode[] }) {
  return (
    <ul className="grid list-disc gap-1.5 pl-5 marker:text-muted">
      {items.map((item, index) => (
        // Static content: the order never changes.
        // biome-ignore lint/suspicious/noArrayIndexKey: static list
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
