"use client";

import { contactEmail } from "@nevile/auth/client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Container } from "@/components/ui/container.tsx";
import { CloseIcon, MailIcon } from "@/components/ui/icons.tsx";
import { useAuthState } from "@/lib/use-auth-state.ts";
import { ResendEmailButton } from "./resend-email-button.tsx";

/** sessionStorage key; holds the id of the user who dismissed the banner in this tab. */
const DISMISSED_KEY = "nevile:verify-banner-dismissed";

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(userId: string): void {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, userId);
  } catch {
    // Storage can be unavailable (private mode); the banner just hides until reload.
  }
}

/**
 * SPEC §1: signed-in users without a verified contact see a slim reminder until they
 * confirm their email. It sits at the end of the page and sticks to the bottom of the
 * screen, so it never pushes content around when the session arrives.
 */
export function VerificationBanner({ hasSessionCookie }: { hasSessionCookie: boolean }) {
  const { status, user, verified } = useAuthState(hasSessionCookie);
  const pathname = usePathname();
  const [dismissedBy, setDismissedBy] = useState<string | null>(null);

  useEffect(() => {
    setDismissedBy(readDismissed());
  }, []);

  if (status !== "signed-in" || !user || verified) return null;
  if (dismissedBy === user.id || pathname.startsWith("/verify-email")) return null;
  const email = contactEmail(user.email);

  return (
    <aside
      aria-label="Confirm your email"
      className="nv-slide-up sticky bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-pop backdrop-blur-sm"
    >
      <Container className="flex items-center gap-x-3 gap-y-2 py-1.5 sm:flex-wrap sm:gap-x-4 sm:py-2.5">
        <p className="flex min-w-0 flex-1 items-start gap-2.5 text-[14px] leading-snug sm:basis-[220px] sm:text-[15px]">
          <MailIcon size={20} className="mt-px flex-none text-primary" />
          <span>
            <strong className="font-semibold">Confirm your email to book and message pros.</strong>{" "}
            {email ? (
              // Phones keep the banner to one short line so it never hides form buttons.
              <span className="hidden text-muted sm:inline">
                We sent a link to <span className="break-all">{email}</span>.
              </span>
            ) : null}
          </span>
        </p>
        <div className="flex items-center gap-1">
          {email ? <ResendEmailButton email={email} layout="inline" /> : null}
          <button
            type="button"
            onClick={() => {
              writeDismissed(user.id);
              setDismissedBy(user.id);
            }}
            className="inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-full text-muted transition duration-150 hover:bg-hover hover:text-ink active:scale-95 motion-reduce:active:scale-100"
          >
            <CloseIcon size={20} />
            <span className="sr-only">Dismiss for now</span>
          </button>
        </div>
      </Container>
    </aside>
  );
}
