"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Container } from "@/components/ui/container.tsx";
import { WarningIcon } from "@/components/ui/icons.tsx";

type ErrorProps = { error: Error & { digest?: string }; reset: () => void };

export default function ErrorBoundary({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Only the digest is logged; server error details are never sent to the browser.
    console.error("Unhandled error", error.digest ?? error.name);
  }, [error]);

  return (
    <Container className="pt-1">
      <section
        aria-labelledby="err-title"
        className="rounded-panel bg-winter-tint px-5 py-12 sm:rounded-hero sm:px-12 sm:py-16"
      >
        <p className="inline-flex items-center gap-2 text-sm font-semibold tracking-[0.06em] text-winter-ink uppercase">
          <WarningIcon size={18} />
          <span>Something went wrong</span>
        </p>
        <h1
          id="err-title"
          className="mt-3 max-w-[18ch] font-display text-[36px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance sm:text-[46px]"
        >
          We hit a patch of ice.
        </h1>
        <p className="mt-4 max-w-[34em] text-[17px] leading-[1.55] text-muted">
          This page didn&apos;t load properly. Try again, and if it keeps happening, come back in a
          few minutes.
        </p>
        {error.digest ? (
          <p className="mt-3 text-sm text-muted">
            Reference: <code className="font-mono">{error.digest}</code>
          </p>
        ) : null}
        <div className="mt-7 flex flex-wrap gap-3">
          <Button size="lg" onClick={reset}>
            Try again
          </Button>
          <Button href="/" variant="secondary" size="lg">
            Back to home
          </Button>
        </div>
      </section>
    </Container>
  );
}
