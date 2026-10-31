// Browser error reporting (SPEC §17): only when NEXT_PUBLIC_SENTRY_DSN is set at build
// time; otherwise this file is empty after bundling and nothing is downloaded.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void Promise.all([import("@sentry/nextjs"), import("@/lib/sentry-options.ts")]).then(
    ([Sentry, { sharedSentryOptions }]) => {
      Sentry.init({ dsn, ...sharedSentryOptions });
    },
  );
}
