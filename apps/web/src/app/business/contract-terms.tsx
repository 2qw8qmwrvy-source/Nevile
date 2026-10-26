"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { centsToDollarInput, formatCad, parseDollarsToCents } from "@nevile/core";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Field, Input, Select } from "@/components/ui/field.tsx";
import { cn } from "@/lib/cn.ts";
import { useTRPC } from "@/lib/trpc.ts";
import { useRefreshListing } from "./use-listing.ts";

type Contract = inferRouterOutputs<AppRouter>["listing"]["get"]["services"][number]["contract"];
type Billing = "upfront" | "monthly" | "either";

const seasonDay = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const asDay = (iso: string) => seasonDay.format(new Date(`${iso}T12:00:00Z`));

/** The next winter's default season: November 15 to March 31. */
function defaultSeason(): { start: string; end: string } {
  const now = new Date();
  const year = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return { start: `${year}-11-15`, end: `${year + 1}-03-31` };
}

/**
 * A Snow & Ice Removal service listed as a seasonal contract (SPEC §21): trigger, season,
 * price per visit or for the season (and how it's paid), and how many customers it takes.
 */
export function ContractTerms({
  businessId,
  serviceId,
  contract,
  canEdit,
  recurring,
}: {
  businessId: string;
  serviceId: string;
  contract: Contract;
  canEdit: boolean;
  recurring: boolean;
}) {
  const trpc = useTRPC();
  const refresh = useRefreshListing(businessId);
  const [editing, setEditing] = useState(false);
  const season = defaultSeason();
  const [values, setValues] = useState({
    triggerCm: String(contract?.triggerCm ?? 5),
    seasonStart: contract?.seasonStart ?? season.start,
    seasonEnd: contract?.seasonEnd ?? season.end,
    pricing: contract?.pricing ?? ("season" as "season" | "per_visit"),
    price: contract ? centsToDollarInput(contract.priceCents) : "",
    seasonBilling: (contract?.seasonBilling ?? "either") as Billing,
    spots: String(contract?.spots ?? 20),
  });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation(
    trpc.listing.setContractTerms.mutationOptions({
      onSuccess: async () => {
        setEditing(false);
        await refresh();
      },
    }),
  );
  const fieldErrors = save.error?.data?.zodError?.fieldErrors as
    | Record<string, string[] | undefined>
    | undefined;
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    const priceCents = parseDollarsToCents(values.price);
    if (priceCents === null) {
      setProblem("Enter the price, like 600 or 45.");
      return;
    }
    save.mutate({
      businessId,
      serviceId,
      terms: {
        triggerCm: Number(values.triggerCm),
        seasonStart: values.seasonStart,
        seasonEnd: values.seasonEnd,
        pricing: values.pricing,
        priceCents,
        seasonBilling: values.pricing === "season" ? values.seasonBilling : null,
        spots: Number(values.spots),
      },
    });
  }

  if (!editing) {
    return (
      <div className="mt-2 rounded-input bg-ground px-3.5 py-2.5 text-sm">
        {contract ? (
          <>
            <p className="font-semibold text-ink">Seasonal contract</p>
            <p className="text-muted">
              {formatCad(contract.priceCents)}{" "}
              {contract.pricing === "season"
                ? `for the season (${
                    contract.seasonBilling === "either"
                      ? "upfront or monthly"
                      : `paid ${contract.seasonBilling}`
                  })`
                : "per visit"}{" "}
              · from {contract.triggerCm} cm · {asDay(contract.seasonStart)} to{" "}
              {asDay(contract.seasonEnd)} · {contract.spotsLeft} of {contract.spots} spots left
            </p>
          </>
        ) : (
          <p className="text-muted">
            Offer this as a seasonal contract: customers sign up for the whole winter and you clear
            them from your snow route.
          </p>
        )}
        {save.error ? (
          <FormAlert tone="error" className="mt-2">
            {save.error.message}
          </FormAlert>
        ) : null}
        {canEdit ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={recurring}
              onClick={() => setEditing(true)}
            >
              {contract ? "Edit contract" : "Set up a seasonal contract"}
            </Button>
            {contract ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => save.mutate({ businessId, serviceId, terms: null })}
              >
                Stop offering it
              </Button>
            ) : null}
          </div>
        ) : null}
        {recurring && !contract ? (
          <p className="mt-1 text-xs text-muted">
            Turn off recurring visits for this service first.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      method="post"
      noValidate
      onSubmit={submit}
      className="mt-2 grid gap-3 rounded-input border border-border bg-ground p-3.5"
    >
      <p className="text-[15px] font-semibold">Seasonal contract</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Clear from (cm)" error={fieldErrors?.triggerCm?.[0]}>
          <Input
            type="number"
            min={1}
            max={50}
            value={values.triggerCm}
            onChange={(event) => set("triggerCm")(event.target.value)}
          />
        </Field>
        <Field label="Season starts" error={fieldErrors?.seasonStart?.[0]}>
          <Input
            type="date"
            value={values.seasonStart}
            onChange={(event) => set("seasonStart")(event.target.value)}
          />
        </Field>
        <Field label="Season ends" error={fieldErrors?.seasonEnd?.[0]}>
          <Input
            type="date"
            value={values.seasonEnd}
            onChange={(event) => set("seasonEnd")(event.target.value)}
          />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1.5 ml-0.5 text-[13px] font-semibold">Price</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["season", "For the whole season", "Split evenly into its months."],
              ["per_visit", "Per visit", "Charged once each visit is confirmed."],
            ] as const
          ).map(([value, title, body]) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-input border bg-surface px-3.5 py-2.5",
                values.pricing === value ? "border-primary" : "border-border hover:border-field",
              )}
            >
              <span className="flex items-center gap-2 font-semibold">
                <input
                  type="radio"
                  name={`pricing-${serviceId}`}
                  checked={values.pricing === value}
                  onChange={() => setValues((current) => ({ ...current, pricing: value }))}
                  className="size-4 accent-primary"
                />
                {title}
              </span>
              <span className="text-sm text-muted">{body}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label={values.pricing === "season" ? "Season price ($)" : "Price per visit ($)"}
          hint="Before HST and Nevile's fee."
          error={fieldErrors?.priceCents?.[0]}
        >
          <Input
            inputMode="decimal"
            icon="dollar"
            value={values.price}
            onChange={(event) => set("price")(event.target.value)}
          />
        </Field>
        {values.pricing === "season" ? (
          <Field label="Customers pay" error={fieldErrors?.seasonBilling?.[0]}>
            <Select
              value={values.seasonBilling}
              onChange={(event) => set("seasonBilling")(event.target.value)}
            >
              <option value="either">Upfront or monthly (they choose)</option>
              <option value="upfront">Upfront</option>
              <option value="monthly">Monthly</option>
            </Select>
          </Field>
        ) : null}
        <Field
          label="Spots"
          hint="How many customers you can take."
          error={fieldErrors?.spots?.[0]}
        >
          <Input
            type="number"
            min={1}
            max={500}
            value={values.spots}
            onChange={(event) => set("spots")(event.target.value)}
          />
        </Field>
      </div>
      {problem || (save.error && !fieldErrors) ? (
        <FormAlert tone="error">{problem ?? save.error?.message}</FormAlert>
      ) : null}
      <p className="text-sm text-muted">
        Customers who already signed up keep the terms they agreed to.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save contract"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
