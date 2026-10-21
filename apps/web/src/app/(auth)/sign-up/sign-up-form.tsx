"use client";

import { NAME_MAX_LENGTH } from "@nevile/auth/client";
import { emailSchema, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@nevile/core";
import type { Route } from "next";
import { type FormEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { authClient, authErrorMessage } from "@/lib/auth-client.ts";
import { FormAlert } from "../_components/form-alert.tsx";
import { PasswordInput } from "../_components/password-input.tsx";

type Fields = { name: string; email: string; password: string; confirm: string };
type FieldErrors = Partial<Record<keyof Fields, string>>;

function validate(fields: Fields): FieldErrors {
  const errors: FieldErrors = {};
  const name = fields.name.trim();
  if (!name) errors.name = "Enter your name.";
  else if (name.length > NAME_MAX_LENGTH)
    errors.name = `Use at most ${NAME_MAX_LENGTH} characters.`;
  if (!emailSchema.safeParse(fields.email).success) errors.email = "Enter a valid email address.";
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

export function SignUpForm({ signInHref }: { signInHref: Route }) {
  const [fields, setFields] = useState<Fields>({ name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

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
    const firstInvalid = (Object.keys(found) as (keyof Fields)[])[0];
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    setPending(true);
    const email = emailSchema.parse(fields.email);
    const { error } = await authClient.signUp.email({
      name: fields.name.trim(),
      email,
      password: fields.password,
    });
    setPending(false);
    if (error) {
      setFormError(authErrorMessage(error, "We couldn't create your account. Please try again."));
      return;
    }
    // The same answer whether or not the address already had an account.
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="grid gap-4">
        <FormAlert tone="success">Check your inbox to finish signing up.</FormAlert>
        <p className="text-[15px] leading-relaxed text-muted">
          We sent a confirmation link to <strong className="break-all text-ink">{sentTo}</strong>.
          It expires in 1 hour. After you confirm, sign in with your email and password.
        </p>
        <Button href={signInHref} block size="lg">
          Go to sign in
        </Button>
        <button
          type="button"
          onClick={() => {
            setSentTo(null);
            setFields((current) => ({ ...current, password: "", confirm: "" }));
          }}
          className="min-h-11 cursor-pointer text-[15px] font-semibold text-primary"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4">
      {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}
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
      <Button type="submit" size="lg" block disabled={pending} aria-busy={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </Button>
      <p className="text-sm leading-relaxed text-muted">
        We&apos;ll email you a link to confirm your address before you can sign in.
      </p>
    </form>
  );
}
