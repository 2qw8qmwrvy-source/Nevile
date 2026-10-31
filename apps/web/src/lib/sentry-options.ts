import type { ErrorEvent } from "@sentry/nextjs";

/** Anything that looks like an email address. */
const EMAIL = /[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g;

function scrub(text: string | undefined): string | undefined {
  return text?.replace(EMAIL, "[email]");
}

/**
 * Strips personal data before an error leaves the server or browser (SPEC §17): no
 * cookies, auth headers, request bodies, query strings, user details or email addresses.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (/cookie|authorization|token|forwarded|x-real-ip/i.test(name)) {
          delete event.request.headers[name];
        }
      }
    }
  }
  delete event.user;
  event.message = scrub(event.message);
  for (const exception of event.exception?.values ?? []) {
    exception.value = scrub(exception.value);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    crumb.message = scrub(crumb.message);
    delete crumb.data;
  }
  return event;
}

export const sharedSentryOptions = {
  sendDefaultPii: false,
  tracesSampleRate: 0,
  release: process.env.APP_VERSION || undefined,
  environment: process.env.NODE_ENV,
  beforeSend: scrubEvent,
};
