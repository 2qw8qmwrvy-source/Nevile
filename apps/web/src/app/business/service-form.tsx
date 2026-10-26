"use client";

import {
  CATEGORY_SLUGS,
  type CategorySlug,
  centsToDollarInput,
  DEFAULT_CATEGORIES,
  FREQUENCY_LABELS,
  formatDurationMinutes,
  parseDollarsToCents,
  RECURRENCE_FREQUENCIES,
  type RecurrenceFrequency,
  SERVICE_DESCRIPTION_MAX_LENGTH,
  SERVICE_DURATION_CHOICES,
  SERVICE_TITLE_MAX_LENGTH,
  type ServiceInput,
} from "@nevile/core";
import { type FormEvent, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field.tsx";
import { cn } from "@/lib/cn.ts";

export type ServiceFormValues = ServiceInput;

type ServiceFormProps = {
  initial?: ServiceFormValues;
  submitLabel: string;
  pending: boolean;
  /** Server-side problems, by field. */
  errors?: Partial<Record<keyof ServiceFormValues | "form", string>>;
  /** Listed as a seasonal contract: no recurring visits. */
  contract?: boolean;
  onSubmit: (values: ServiceFormValues) => void;
  onCancel: () => void;
};

const BLANK: ServiceFormValues = {
  categorySlug: CATEGORY_SLUGS[0],
  title: "",
  description: "",
  pricingType: "fixed",
  priceCents: null,
  fromPriceCents: null,
  durationMinutes: 60,
  instantBook: true,
  active: true,
  recurrenceFrequencies: [],
};

/** Add or edit a service: category, title, pricing (fixed or quote), duration (SPEC §18). */
export function ServiceForm({
  initial = BLANK,
  submitLabel,
  pending,
  errors,
  onSubmit,
  onCancel,
  contract = false,
}: ServiceFormProps) {
  const [values, setValues] = useState(initial);
  const [price, setPrice] = useState(
    initial.priceCents !== null && initial.priceCents !== undefined
      ? centsToDollarInput(initial.priceCents)
      : "",
  );
  const [fromPrice, setFromPrice] = useState(
    initial.fromPriceCents !== null && initial.fromPriceCents !== undefined
      ? centsToDollarInput(initial.fromPriceCents)
      : "",
  );
  const [local, setLocal] = useState<{ price?: string; fromPrice?: string }>({});
  const set = <K extends keyof ServiceFormValues>(key: K, value: ServiceFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const fixed = values.pricingType === "fixed";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems: { price?: string; fromPrice?: string } = {};
    const priceCents = fixed ? parseDollarsToCents(price) : null;
    if (fixed && priceCents === null)
      problems.price = "Enter the price per visit, like 60 or 60.50.";
    const fromCents = !fixed && fromPrice.trim() ? parseDollarsToCents(fromPrice) : null;
    if (!fixed && fromPrice.trim() && fromCents === null) {
      problems.fromPrice = "Enter an amount like 45, or leave it empty.";
    }
    setLocal(problems);
    if (problems.price || problems.fromPrice) return;
    onSubmit({
      ...values,
      priceCents,
      fromPriceCents: fromCents,
      instantBook: fixed ? values.instantBook : false,
      recurrenceFrequencies: fixed && !contract ? (values.recurrenceFrequencies ?? []) : [],
    });
  }

  return (
    <form method="post" onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" error={errors?.categorySlug}>
          <Select
            value={values.categorySlug}
            onChange={(event) => set("categorySlug", event.target.value as CategorySlug)}
          >
            {DEFAULT_CATEGORIES.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Service name" error={errors?.title}>
          <Input
            value={values.title}
            maxLength={SERVICE_TITLE_MAX_LENGTH}
            placeholder="e.g. Weekly mowing"
            onChange={(event) => set("title", event.target.value)}
          />
        </Field>
      </div>
      <Field
        label="Description (optional)"
        hint="What's included, and anything customers should know."
        error={errors?.description}
      >
        <Textarea
          rows={3}
          value={values.description}
          maxLength={SERVICE_DESCRIPTION_MAX_LENGTH}
          onChange={(event) => set("description", event.target.value)}
        />
      </Field>
      <fieldset>
        <legend className="mb-1.5 ml-0.5 text-[13px] font-semibold">Pricing</legend>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {(
            [
              {
                value: "fixed",
                title: "Fixed price per visit",
                body: "Customers see the price and book.",
              },
              {
                value: "quote",
                title: "Request a quote",
                body: "You send a price after the customer describes the job.",
              },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-input border px-3.5 py-3 transition-colors",
                values.pricingType === option.value
                  ? "border-primary bg-primary-soft"
                  : "border-border hover:border-field",
              )}
            >
              <span className="flex items-center gap-2 font-semibold">
                <input
                  type="radio"
                  name="pricingType"
                  value={option.value}
                  checked={values.pricingType === option.value}
                  onChange={() => set("pricingType", option.value)}
                  className="size-4 accent-primary"
                />
                {option.title}
              </span>
              <span className="text-sm text-muted">{option.body}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        {fixed ? (
          <Field
            label="Price per visit ($)"
            hint="Before HST and Nevile's fee."
            error={local.price ?? errors?.priceCents}
          >
            <Input
              inputMode="decimal"
              icon="dollar"
              value={price}
              placeholder="60"
              onChange={(event) => setPrice(event.target.value)}
            />
          </Field>
        ) : (
          <Field
            label="From price ($, optional)"
            hint="Shown as “Quote · from $45”."
            error={local.fromPrice ?? errors?.fromPriceCents}
          >
            <Input
              inputMode="decimal"
              icon="dollar"
              value={fromPrice}
              placeholder="45"
              onChange={(event) => setFromPrice(event.target.value)}
            />
          </Field>
        )}
        <Field label="Typical time on site" error={errors?.durationMinutes}>
          <Select
            value={String(values.durationMinutes)}
            onChange={(event) => set("durationMinutes", Number(event.target.value))}
          >
            {SERVICE_DURATION_CHOICES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {formatDurationMinutes(minutes)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {fixed ? (
        <Checkbox
          checked={values.instantBook}
          onChange={(event) => set("instantBook", event.target.checked)}
          label="Allow Instant Book for this service"
          description="Applies when Instant Book is on in your profile."
        />
      ) : null}
      {fixed && !contract ? (
        <fieldset>
          <legend className="mb-1 ml-0.5 text-[13px] font-semibold">Recurring visits</legend>
          <p className="mb-1.5 ml-0.5 text-sm text-muted">
            Let customers book this on a schedule (up to 6 months). You accept each series.
          </p>
          <div className="flex flex-wrap gap-x-5">
            {RECURRENCE_FREQUENCIES.map((frequency: RecurrenceFrequency) => {
              const chosen = values.recurrenceFrequencies ?? [];
              return (
                <Checkbox
                  key={frequency}
                  label={FREQUENCY_LABELS[frequency]}
                  checked={chosen.includes(frequency)}
                  onChange={(event) =>
                    set(
                      "recurrenceFrequencies",
                      event.target.checked
                        ? RECURRENCE_FREQUENCIES.filter(
                            (option) => option === frequency || chosen.includes(option),
                          )
                        : chosen.filter((option) => option !== frequency),
                    )
                  }
                />
              );
            })}
          </div>
          {errors?.recurrenceFrequencies ? (
            <p className="text-sm text-danger">{errors.recurrenceFrequencies}</p>
          ) : null}
        </fieldset>
      ) : null}
      <Checkbox
        checked={values.active}
        onChange={(event) => set("active", event.target.checked)}
        label="Show this service to customers"
      />
      {errors?.form ? <FormAlert tone="error">{errors.form}</FormAlert> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
