"use client";

import { emailSchema } from "@nevile/core";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { authClient, authErrorMessage } from "@/lib/auth-client.ts";
import { FormAlert } from "../_components/form-alert.tsx";

/** Requests a new confirmation link. The reply never says whether the address has an account. */
export function ResendVerificationForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError("Enter a valid email address.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: sendError } = await authClient.sendVerificationEmail({ email: parsed.data });
    setPending(false);
    if (sendError) {
      setError(authErrorMessage(sendError, "We couldn't send a new link. Please try again."));
      return;
    }
    setSentTo(parsed.data);
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {sentTo ? (
        <FormAlert tone="success">
          If {sentTo} has an unconfirmed Nevile account, a new link is on its way.
        </FormAlert>
      ) : null}
      <Field label="Email">
        <Input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </Field>
      <Button
        type="submit"
        variant="secondary"
        size="lg"
        block
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Sending…" : "Send a new link"}
      </Button>
    </form>
  );
}
