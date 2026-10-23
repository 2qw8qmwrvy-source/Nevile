"use client";

import { BUSINESS_NAME_MAX_LENGTH, LAUNCH_PROVINCES, PROVINCES } from "@nevile/core";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { useTRPC } from "@/lib/trpc.ts";

/** Nevile launches in Nova Scotia only (SPEC §2), so every new business is set up there. */
const LAUNCH_PROVINCE = LAUNCH_PROVINCES[0];

/**
 * "Switch to business mode" for accounts without a business: names the business, then
 * creates it in the launch province with the caller as owner.
 */
export function BusinessModeForm({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const create = useMutation(
    trpc.business.create.mutationOptions({
      onSuccess: () => router.refresh(),
    }),
  );
  const fieldErrors = create.error?.data?.zodError?.fieldErrors;
  const nameError = fieldErrors?.name?.[0];
  const provinceError = fieldErrors?.province?.[0];
  const formError = create.error && !nameError ? (provinceError ?? create.error.message) : null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate({ name, province: LAUNCH_PROVINCE });
  }

  if (!open) {
    return (
      <>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          List your services, take bookings and get paid every Monday. Teams are free on every plan.
        </p>
        <Button
          size="lg"
          block
          className="mt-5"
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => formRef.current?.querySelector("input")?.focus());
          }}
        >
          Switch to business mode
        </Button>
      </>
    );
  }

  return (
    <form ref={formRef} method="post" onSubmit={onSubmit} noValidate className="mt-4 grid gap-4">
      <p className="text-[15px] leading-relaxed text-muted">
        Tell us about your business. You can add services, your team and payout details next.
      </p>
      {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}
      <Field label="Business name" error={nameError}>
        <Input
          name="businessName"
          autoComplete="organization"
          value={name}
          maxLength={BUSINESS_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>
      <p className="rounded-input border border-border bg-ground px-3.5 py-3 text-[15px] leading-snug">
        <strong>{PROVINCES[LAUNCH_PROVINCE].name}</strong>
        <span className="text-muted">
          {" "}
          · Nevile is only in Nova Scotia for now. You&apos;ll draw your exact service area on a map
          when you add your services.
        </span>
      </p>
      <Button
        type="submit"
        size="lg"
        block
        disabled={create.isPending}
        aria-busy={create.isPending}
      >
        {create.isPending ? "Setting up your business…" : "Create business and switch"}
      </Button>
    </form>
  );
}
