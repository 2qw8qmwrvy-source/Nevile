"use client";

import { emailSchema } from "@nevile/core";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { authClient, authErrorMessage } from "@/lib/auth-client.ts";
import { FormAlert } from "../_components/form-alert.tsx";
import { PasswordInput } from "../_components/password-input.tsx";

export function EmailSignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ tone: "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success || !password) {
      setMessage({ tone: "error", text: "Enter your email and password." });
      return;
    }
    setPending(true);
    setMessage(null);
    const { error } = await authClient.signIn.email({ email: parsed.data, password });
    if (error) {
      setPending(false);
      setPassword("");
      setMessage({ tone: "error", text: authErrorMessage(error) });
      return;
    }
    router.replace(next as Route);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
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
      <Field label="Password">
        <PasswordInput
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </Field>
      <Button type="submit" size="lg" block disabled={pending} aria-busy={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
