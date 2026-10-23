"use client";

import { useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button.tsx";
import { authClient, authErrorMessage } from "@/lib/auth-client.ts";
import { cn } from "@/lib/cn.ts";

type ResendEmailButtonProps = {
  email: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Show the result under the button (default) or beside it. */
  layout?: "stack" | "inline";
};

type Status = { tone: "success" | "error"; text: string } | null;

/** Sends a fresh confirmation link to the signed-in user's own address. */
export function ResendEmailButton({
  email,
  variant = "secondary",
  size = "sm",
  className,
  layout = "stack",
}: ResendEmailButtonProps) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function onClick() {
    setPending(true);
    setStatus(null);
    const { error } = await authClient.sendVerificationEmail({ email });
    setPending(false);
    setStatus(
      error
        ? { tone: "error", text: authErrorMessage(error, "We couldn't send a new link. Try again.") }
        : { tone: "success", text: "Sent. Check your inbox (and spam folder)." },
    );
  }

  return (
    <div
      className={cn(
        layout === "inline" ? "flex flex-wrap items-center gap-x-3 gap-y-1" : "grid gap-1.5",
        className,
      )}
    >
      <Button
        variant={variant}
        size={size}
        onClick={onClick}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Sending…" : "Resend email"}
      </Button>
      {/* Always rendered so screen readers announce the result when it appears. */}
      <span
        role="status"
        className={cn(
          "text-sm font-medium",
          status?.tone === "error" ? "text-danger" : "text-primary",
          !status && "sr-only",
        )}
      >
        {status?.text ?? ""}
      </span>
    </div>
  );
}
