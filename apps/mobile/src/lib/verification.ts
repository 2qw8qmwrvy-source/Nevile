/**
 * The SPEC §1 verification gate as the app sees it: whether the signed-in person still has
 * to confirm a contact, and resending the confirmation email. The server enforces the gate
 * (`verifiedProcedure`); this only drives the banner and friendly messages.
 */
import { contactEmail, hasVerifiedContact } from "@nevile/auth/client";
import { useEffect, useState, useSyncExternalStore } from "react";

import { authClient, authErrorMessage, callAuth, EMAIL_LINK_EXPIRES_IN_HOURS } from "./auth.ts";
import type { FormAlertTone } from "./auth-ui.tsx";
import { useMe } from "./me.ts";

/** Seconds between resend requests; the server also rate-limits them. */
export const RESEND_COOLDOWN_SECONDS = 60;

// When the last email was requested, shared by every banner so they agree on the cooldown.
let lastSentAt = 0;
const listeners = new Set<() => void>();
const sentStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => lastSentAt,
  set(at: number) {
    lastSentAt = at;
    for (const listener of listeners) listener();
  },
};

function secondsLeft(sentAt: number, now: number): number {
  const left = Math.ceil((sentAt + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000);
  return Math.min(RESEND_COOLDOWN_SECONDS, Math.max(0, left));
}

export type VerificationNotice = { tone: FormAlertTone; text: string };

export type EmailVerification = {
  /** Signed in without a confirmed email or SMS-verified phone. */
  needed: boolean;
  /** The address to confirm; null for accounts without a real email. */
  email: string | null;
  sending: boolean;
  /** Seconds until Resend is available again. */
  cooldown: number;
  notice: VerificationNotice | null;
  resend: () => Promise<void>;
};

export function useEmailVerification(): EmailVerification {
  const { user, me, session } = useMe();
  const sentAt = useSyncExternalStore(sentStore.subscribe, sentStore.get);
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<VerificationNotice | null>(null);
  const cooldown = secondsLeft(sentAt, now);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // The API's answer wins; the cached session covers the moment before it loads.
  const verified = me.data ? me.data.verified : user ? hasVerifiedContact(user) : true;
  const email = me.data ? me.data.user.email : user ? contactEmail(user.email) : null;
  const needed = user !== null && !verified;

  async function resend() {
    if (!email || sending || cooldown > 0) return;
    setSending(true);
    setNotice(null);
    const { error } = await callAuth(() => authClient.sendVerificationEmail({ email }));
    setSending(false);
    if (error) {
      if (error.code === "EMAIL_ALREADY_VERIFIED") {
        void me.refetch();
        void session.refetch();
        return;
      }
      setNotice({
        tone: "error",
        text: authErrorMessage(error, "We couldn't send the email. Please try again."),
      });
      return;
    }
    const at = Date.now();
    setNow(at);
    sentStore.set(at);
    const hours =
      EMAIL_LINK_EXPIRES_IN_HOURS === 1 ? "1 hour" : `${EMAIL_LINK_EXPIRES_IN_HOURS} hours`;
    setNotice({
      tone: "success",
      text: `Sent. Open the link we emailed to ${email} within ${hours}.`,
    });
  }

  return { needed, email, sending, cooldown, notice, resend };
}
