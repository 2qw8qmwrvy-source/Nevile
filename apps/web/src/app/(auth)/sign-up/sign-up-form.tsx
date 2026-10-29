"use client";

import { NAME_MAX_LENGTH } from "@nevile/auth/client";
import {
  emailSchema,
  launchPostalCodeSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@nevile/core";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { authClient, authErrorMessage, POSTAL_CODE_ERROR_CODES } from "@/lib/auth-client.ts";
import { postalCodeError } from "@/lib/postal-code.ts";
import { FormAlert } from "../_components/form-alert.tsx";
import { MarketingConsent } from "../_components/marketing-consent.tsx";
import { PasswordInput } from "../_components/password-input.tsx";

type Fields = {
  name: string;
  email: string;
  postalCode: string;
  password: string;
  confirm: string;
};
type FieldErrors = Partial<Record<keyof Fields, string>>;

const FIELD_ORDER: readonly (keyof Fields)[] = [
  "name",
  "email",
  "postalCode",
  "password",
  "confirm",
];

function validate(fields: Fields): FieldErrors {
  const errors: FieldErrors = {};
  const name = fields.name.trim();
  if (!name) errors.name = "Enter your name.";
  else if (name.length > NAME_MAX_LENGTH)
    errors.name = `Use at most ${NAME_MAX_LENGTH} characters.`;
  if (!emailSchema.safeParse(fields.email).success) errors.email = "Enter a valid email address.";
  const postal = postalCodeError(fields.postalCode);
  if (postal) errors.postalCode = postal;
  if (fields.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (fields.password.length > PASSWORD_MAX_LENGTH) {
    errors.password = `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!errors.password && fields.confirm !== fields.password) {
    errors.confirm = "The passwords don't match.";
  }
  return errors;
}

type SignUpFormProps = {
  signInHref: Route;
  /** Where to go once the account exists: the welcome flow (SPEC §16). */
  next: Route;
};

/**
 * Email sign-up. Nova Scotia postal codes only (SPEC §2), checked here as a hint and
 * enforced by the server. A new account is signed in straight away; the confirmation
 * email unlocks booking and messaging (SPEC §1).
 */
export function SignUpForm({ signInHref, next }: SignUpFormProps) {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>({
    name: "",
    email: "",
    postalCode: "",
    password: "",
    confirm: "",
  });
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<{ text: string; signIn?: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function focusField(key: keyof Fields) {
    formRef.current?.querySelector<HTMLInputElement>(`[name="${key}"]`)?.focus();
  }

  function update(key: keyof Fields) {
    return (event: { target: { value: string } }) => {
      setFields((current) => ({ ...current, [key]: event.target.value }));
      if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const found = validate(fields);
    setErrors(found);
    const firstInvalid = FIELD_ORDER.find((key) => found[key]);
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }
    setPending(true);
    const { error } = await authClient.signUp.email({
      name: fields.name.trim(),
      email: emailSchema.parse(fields.email),
      password: fields.password,
      postalCode: launchPostalCodeSchema.parse(fields.postalCode),
      marketingConsent,
    });
    if (error) {
      setPending(false);
      const message = authErrorMessage(error, "We couldn't create your account. Please try again.");
      if (error.code && POSTAL_CODE_ERROR_CODES.has(error.code)) {
        setErrors({ postalCode: message });
        focusField("postalCode");
      } else if (error.code?.startsWith("USER_ALREADY_EXISTS")) {
        setFormError({ text: message, signIn: true });
      } else {
        setFormError({ text: message });
      }
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    // POST: a submit before the page is interactive must never put the password in the URL.
    <form ref={formRef} method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
      {formError ? (
        <FormAlert tone="error">
          {formError.text}{" "}
          {formError.signIn ? (
            <Link href={signInHref} className="font-semibold text-danger underline">
              Go to sign in
            </Link>
          ) : null}
        </FormAlert>
      ) : null}
      <Field label="Your name" error={errors.name}>
        <Input
          name="name"
          autoComplete="name"
          value={fields.name}
          onChange={update("name")}
          maxLength={NAME_MAX_LENGTH}
          required
        />
      </Field>
      <Field label="Email" error={errors.email}>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={fields.email}
          onChange={update("email")}
          required
        />
      </Field>
      <Field
        label="Postal code"
        hint="Nevile is only in Nova Scotia for now (postal codes start with B)."
        error={errors.postalCode}
      >
        <Input
          name="postalCode"
          autoComplete="postal-code"
          autoCapitalize="characters"
          placeholder="B3H 1A1"
          maxLength={7}
          value={fields.postalCode}
          onChange={update("postalCode")}
          onBlur={() => {
            if (fields.postalCode.trim()) {
              const problem = postalCodeError(fields.postalCode);
              if (problem) setErrors((current) => ({ ...current, postalCode: problem }));
            }
          }}
          className="uppercase"
          required
        />
      </Field>
      <Field
        label="Password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase works well.`}
        error={errors.password}
      >
        <PasswordInput
          name="password"
          autoComplete="new-password"
          value={fields.password}
          onChange={update("password")}
          maxLength={PASSWORD_MAX_LENGTH}
          required
        />
      </Field>
      <Field label="Confirm password" error={errors.confirm}>
        <PasswordInput
          name="confirm"
          autoComplete="new-password"
          value={fields.confirm}
          onChange={update("confirm")}
          maxLength={PASSWORD_MAX_LENGTH}
          required
        />
      </Field>
      <MarketingConsent checked={marketingConsent} onChange={setMarketingConsent} />
      <Button type="submit" size="lg" block disabled={pending} aria-busy={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </Button>
      <p className="text-sm leading-relaxed text-muted">
        You&apos;ll be signed in right away. We&apos;ll email you a link to confirm your address
        before you book or message a pro. By creating an account you agree to our{" "}
        <Link href="/terms" className="font-semibold text-primary">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="font-semibold text-primary">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}
