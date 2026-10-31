import type { Metadata } from "next";
import { Button } from "@/components/ui/button.tsx";
import { Container } from "@/components/ui/container.tsx";
import { LeafIcon } from "@/components/ui/icons.tsx";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <Container className="pt-1">
      <section
        aria-labelledby="nf-title"
        className="rounded-panel bg-fall-tint px-5 py-12 sm:rounded-hero sm:px-12 sm:py-16"
      >
        <p className="inline-flex items-center gap-2 text-sm font-semibold tracking-[0.06em] text-fall-ink uppercase">
          <LeafIcon size={18} />
          <span>Error 404</span>
        </p>
        <h1
          id="nf-title"
          className="mt-3 max-w-[18ch] font-display text-[36px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance sm:text-[46px]"
        >
          This page blew away with the leaves.
        </h1>
        <p className="mt-4 max-w-[34em] text-[17px] leading-[1.55] text-muted">
          The link may be old or mistyped. Head back home to find a local service.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button href="/" size="lg">
            Back to home
          </Button>
          <Button href="/search" variant="secondary" size="lg">
            Browse services
          </Button>
        </div>
      </section>
    </Container>
  );
}
