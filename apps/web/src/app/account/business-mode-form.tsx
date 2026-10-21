"use client";

import { PROVINCE_CODES, PROVINCES, type ProvinceCode } from "@nevile/core";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Field, Input, Select } from "@/components/ui/field.tsx";
import { useTRPC } from "@/lib/trpc.ts";

// Mirrors BUSINESS_NAME_MAX_LENGTH in @nevile/api (server-only, so not imported here).
const NAME_MAX_LENGTH = 80;

/**
 * "Switch to business mode" for accounts without a business: names the business and its
 * province, then creates it with the caller as owner.
 */
export function BusinessModeForm({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");
  const [province, setProvince] = useState<ProvinceCode>("ON");
  const formRef = useRef<HTMLFormElement>(null);

  const create = useMutation(
    trpc.business.create.mutationOptions({
      onSuccess: () => router.refresh(),
    }),
  );
  const fieldErrors = create.error?.data?.zodError?.fieldErrors;
  const nameError = fieldErrors?.name?.[0];
  const provinceError = fieldErrors?.province?.[0] ? "Choose a province or territory." : undefined;
  const formError = create.error && !nameError && !provinceError ? create.error.message : null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate({ name, province });
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
    <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-4 grid gap-4">
      <p className="text-[15px] leading-relaxed text-muted">
        Tell us about your business. You can add services, your team and payout details next.
      </p>
      {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}
      <Field label="Business name" error={nameError}>
        <Input
          name="businessName"
          autoComplete="organization"
          value={name}
          maxLength={NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>
      <Field
        label="Province or territory"
        hint="Where you do most of your work."
        error={provinceError}
      >
        <Select
          name="province"
          value={province}
          onChange={(event) => setProvince(event.target.value as ProvinceCode)}
        >
          {PROVINCE_CODES.map((code) => (
            <option key={code} value={code}>
              {PROVINCES[code].name}
            </option>
          ))}
        </Select>
      </Field>
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
