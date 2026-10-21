"use client";

import { color } from "@nevile/tokens";

type GlobalErrorProps = { error: Error & { digest?: string }; reset: () => void };

/** Last-resort boundary when the root layout itself fails; styles are inline on purpose. */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en-CA">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: 16,
          background: color.ground,
          color: color.ink,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: 32, lineHeight: 1.1, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: color.muted, marginTop: 12 }}>
            Nevile couldn&apos;t load. Please try again.
          </p>
          {error.digest ? (
            <p style={{ color: color.muted, fontSize: 14 }}>Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              minHeight: 48,
              padding: "0 24px",
              border: 0,
              borderRadius: 999,
              background: color.primary,
              color: color.onPrimary,
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
