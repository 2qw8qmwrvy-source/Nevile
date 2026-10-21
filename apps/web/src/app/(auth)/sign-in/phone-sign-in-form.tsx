"use client";

import { OTP_EXPIRES_IN_SECONDS, OTP_LENGTH } from "@nevile/auth/client";
import { normalizeCanadianPhone } from "@nevile/core";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { authClient, authErrorMessage } from "@/lib/auth-client.ts";
import { FormAlert } from "../_components/form-alert.tsx";

const CODE_LENGTH = OTP_LENGTH;
const CODE_EXPIRES_IN_MINUTES = OTP_EXPIRES_IN_SECONDS / 60;
const RESEND_AFTER_SECONDS = 30;

/** "+14165551234" → "(416) 555-1234" */
function formatPhone(e164: string): string {
  const digits = e164.replace(/^\+1/, "");
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Phone sign-in and sign-up in one: request a code, then enter it. Verifying a code for a
 * new number creates the account.
 */
export function PhoneSignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeFieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(target: string): Promise<boolean> {
    setPending(true);
    setError(null);
    const { error: sendError } = await authClient.phoneNumber.sendOtp({ phoneNumber: target });
    setPending(false);
    if (sendError) {
      setError(authErrorMessage(sendError, "We couldn't send a code. Please try again."));
      return false;
    }
    setCooldown(RESEND_AFTER_SECONDS);
    return true;
  }

  async function onRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeCanadianPhone(phoneInput);
    if (!normalized) {
      setError("Enter a Canadian mobile number, like 416 555 0123.");
      return;
    }
    if (await sendCode(normalized)) {
      setPhone(normalized);
      setCode("");
      setNotice(`We texted a ${CODE_LENGTH}-digit code to ${formatPhone(normalized)}.`);
      requestAnimationFrame(() => codeFieldRef.current?.querySelector("input")?.focus());
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!phone) return;
    const digits = code.replace(/\D/g, "");
    if (digits.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code from the text message.`);
      return;
    }
    setPending(true);
    setError(null);
    const { error: verifyError } = await authClient.phoneNumber.verify({
      phoneNumber: phone,
      code: digits,
    });
    if (verifyError) {
      setPending(false);
      setCode("");
      setError(authErrorMessage(verifyError, "We couldn't check that code. Please try again."));
      return;
    }
    router.replace(next as Route);
    router.refresh();
  }

  if (!phone) {
    return (
      <form onSubmit={onRequestCode} noValidate className="grid gap-4">
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <Field
          label="Mobile number"
          hint="We'll text you a code. New to Nevile? This creates your account."
        >
          <Input
            name="phone"
            type="tel"
            autoComplete="tel-national"
            inputMode="tel"
            placeholder="416 555 0123"
            value={phoneInput}
            onChange={(event) => setPhoneInput(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" size="lg" block disabled={pending} aria-busy={pending}>
          {pending ? "Sending code…" : "Text me a code"}
        </Button>
        <p className="text-sm leading-relaxed text-muted">
          Message and data rates may apply. We only use your number for sign-in codes.
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={onVerify} noValidate className="grid gap-4">
      {error ? (
        <FormAlert tone="error">{error}</FormAlert>
      ) : notice ? (
        <FormAlert tone="info">
          {notice} It expires in {CODE_EXPIRES_IN_MINUTES} minutes.
        </FormAlert>
      ) : null}
      <div ref={codeFieldRef}>
        <Field label="Code">
          <Input
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            className="text-center font-display text-[22px] tracking-[0.4em]"
            required
          />
        </Field>
      </div>
      <Button type="submit" size="lg" block disabled={pending} aria-busy={pending}>
        {pending ? "Checking…" : "Sign in"}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
        <button
          type="button"
          disabled={pending || cooldown > 0}
          onClick={async () => {
            if (await sendCode(phone)) {
              setCode("");
              setNotice(`We texted a new code to ${formatPhone(phone)}.`);
            }
          }}
          className="min-h-11 cursor-pointer font-semibold text-primary disabled:cursor-not-allowed disabled:text-muted"
        >
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
        </button>
        <button
          type="button"
          onClick={() => {
            setPhone(null);
            setError(null);
            setNotice(null);
          }}
          className="min-h-11 cursor-pointer font-semibold text-primary"
        >
          Use a different number
        </button>
      </div>
    </form>
  );
}
