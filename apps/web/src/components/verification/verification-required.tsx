import type { ReactNode } from "react";
import { MailIcon } from "@/components/ui/icons.tsx";
import { cn } from "@/lib/cn.ts";
import { ResendEmailButton } from "./resend-email-button.tsx";

type VerificationRequiredProps = {
  /** What the person is trying to do, e.g. "switch to business mode". */
  action: string;
  /** The account's real email address, if it has one. */
  email: string | null;
  children?: ReactNode;
  className?: string;
};

/**
 * Inline notice for actions behind the SPEC §1 verification gate, shown instead of the
 * form so nobody hits a server error. The server enforces the same rule regardless.
 */
export function VerificationRequired({
  action,
  email,
  children,
  className,
}: VerificationRequiredProps) {
  return (
    <div
      className={cn(
        "grid gap-3 rounded-input border border-season-tint bg-season-tint/60 px-4 py-4",
        className,
      )}
    >
      <p className="flex items-start gap-2.5 text-[15px] leading-snug">
        <MailIcon size={20} className="mt-px flex-none text-season-ink" />
        <span>
          <strong className="font-semibold">Confirm your email to {action}.</strong>{" "}
          <span className="text-muted">
            {email ? (
              <>
                Open the link we sent to <span className="break-all text-ink">{email}</span>. It
                only takes a moment, and it keeps Nevile safe for everyone.
              </>
            ) : (
              "Sign in with a text code to verify your phone number, then come back here."
            )}
          </span>
        </span>
      </p>
      {children}
      {email ? <ResendEmailButton email={email} /> : null}
    </div>
  );
}
