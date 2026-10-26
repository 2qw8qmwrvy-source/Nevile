"use client";

import { formatCad, postalAreaOf } from "@nevile/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { CardSetupButton } from "@/app/account/card/card-setup-button.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Checkbox } from "@/components/ui/field.tsx";
import { ArrowRightIcon } from "@/components/ui/icons.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/cn.ts";
import { useTRPC } from "@/lib/trpc.ts";
import { AddressCard, addressProblem, type JobAddress } from "./address-card.tsx";

/** A pro's listed snow contract, or the snow contract terms in their quote. */
export type ContractSource =
  | { kind: "service"; serviceId: string }
  | { kind: "quote"; quoteId: string };

type ContractFlowProps = {
  source: ContractSource;
  defaultPostal: string;
  /** This page's path, to come back to after adding a card. */
  returnPath: string;
};

type Plan = "upfront" | "monthly";

/**
 * Signing up for a seasonal snow contract (SPEC §21): the terms and price (and the payment
 * plan, when the pro offers both), the plain-language agreement to read and agree to, the
 * address and the saved card. A listed contract needs the pro's OK within 24 hours; a
 * pro's own quoted terms are confirmed straight away.
 */
export function ContractFlow({ source, defaultPostal, returnPath }: ContractFlowProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [address, setAddress] = useState<JobAddress>({
    line1: "",
    line2: "",
    city: "",
    postalCode: defaultPostal,
  });
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const listed = useQuery({
    ...trpc.snow.offer.queryOptions({
      serviceId: source.kind === "service" ? source.serviceId : "",
      seasonPayment: plan,
    }),
    enabled: source.kind === "service",
    placeholderData: (previous) => previous,
  });
  const quoted = useQuery({
    ...trpc.snow.quoteOffer.queryOptions({
      quoteId: source.kind === "quote" ? source.quoteId : "",
      seasonPayment: plan,
    }),
    enabled: source.kind === "quote",
    placeholderData: (previous) => previous,
  });
  const offer = source.kind === "service" ? listed : quoted;
  const card = useQuery(trpc.cards.get.queryOptions());
  const signedUp = {
    onSuccess: ({ bookingId }: { bookingId: string }) =>
      router.push(`/bookings/${bookingId}?new=1` as Route),
  };
  const signUp = useMutation(trpc.snow.signUp.mutationOptions(signedUp));
  const signUpQuote = useMutation(trpc.snow.signUpFromQuote.mutationOptions(signedUp));
  const sending = source.kind === "service" ? signUp : signUpQuote;
  const fieldErrors = sending.error?.data?.zodError?.fieldErrors as
    | Record<string, string[] | undefined>
    | undefined;
  const data = offer.data;
  const choosesPlan = data?.terms.pricing === "season" && data.terms.seasonBilling === "either";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    const addressIssue = addressProblem(address, postalAreaOf);
    if (addressIssue) {
      setProblem(addressIssue);
      return;
    }
    if (choosesPlan && !plan) {
      setProblem("Choose to pay upfront or monthly.");
      return;
    }
    if (!agreed) {
      setProblem("Read the agreement and tick “I agree” to sign up.");
      return;
    }
    const input = { address, notes, seasonPayment: plan, agreed: true as const };
    if (source.kind === "quote") signUpQuote.mutate({ ...input, quoteId: source.quoteId });
    else signUp.mutate({ ...input, serviceId: source.serviceId });
  }

  if (offer.isPending) return <Skeleton className="mt-6 h-96" />;
  if (offer.isError || !data) {
    return (
      <FormAlert tone="error" className="mt-6 max-w-xl">
        {offer.error?.message ?? "This contract isn't available."}
      </FormAlert>
    );
  }
  if (!data.open) {
    return (
      <p className="mt-6 max-w-xl rounded-card border border-border bg-surface p-5 text-[15px]">
        {data.seasonOver
          ? "This season is over."
          : data.spotsLeft === 0
            ? "No spots left on this contract. Ask the pro for a quote, or find another pro nearby."
            : `${data.business.name} isn't taking new sign-ups right now.`}
      </p>
    );
  }

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      noValidate
      className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start"
    >
      <div className="grid gap-6">
        <Card as="section" aria-labelledby="terms-title">
          <h2 id="terms-title" className="font-display text-[20px] font-bold">
            The contract
          </h2>
          <dl className="mt-3 grid gap-2 text-[15px] sm:grid-cols-[150px_1fr]">
            <dt className="font-semibold">Season</dt>
            <dd>{data.terms.season}</dd>
            <dt className="font-semibold">Cleared when</dt>
            <dd>Snowfall reaches {data.terms.triggerCm} cm</dd>
            <dt className="font-semibold">Price</dt>
            <dd>
              {formatCad(data.terms.priceCents)}{" "}
              {data.terms.pricing === "season" ? "for the season" : "per visit"}
            </dd>
            {data.spotsLeft !== null ? (
              <>
                <dt className="font-semibold">Spots left</dt>
                <dd>{data.spotsLeft}</dd>
              </>
            ) : null}
          </dl>
          {data.service.description ? (
            <p className="mt-3 text-[15px] whitespace-pre-line text-muted">
              {data.service.description}
            </p>
          ) : null}
        </Card>

        {choosesPlan ? (
          <Card as="section" aria-labelledby="plan-title">
            <h2 id="plan-title" className="font-display text-[20px] font-bold">
              How you pay
            </h2>
            <fieldset className="mt-3 grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">How you pay</legend>
              {(
                [
                  ["upfront", "Upfront", "The whole season when the pro accepts."],
                  [
                    "monthly",
                    "Monthly",
                    "This month when the pro accepts, then each month on the 1st.",
                  ],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-start gap-2.5 rounded-input border px-3.5 py-2.5 text-[15px] transition-colors",
                    plan === value
                      ? "border-primary bg-primary-soft"
                      : "border-border hover:border-field",
                  )}
                >
                  <input
                    type="radio"
                    name="plan"
                    value={value}
                    checked={plan === value}
                    onChange={() => setPlan(value)}
                    className="mt-1 size-4 accent-primary"
                  />
                  <span>
                    <span className="block font-semibold">{label}</span>
                    <span className="block text-sm text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </Card>
        ) : null}

        <AddressCard
          hint="The pro sees the address once the contract is confirmed."
          address={address}
          onAddress={setAddress}
          notes={notes}
          onNotes={setNotes}
          error={fieldErrors?.address?.[0]}
        />

        <Card as="section" aria-labelledby="agreement-title">
          <h2 id="agreement-title" className="font-display text-[20px] font-bold">
            The agreement
          </h2>
          <p className="mt-1 text-[15px] text-muted">
            Please read it. You and the pro both get a PDF copy by email.
          </p>
          <div className="mt-4 grid max-h-[28rem] gap-4 overflow-y-auto rounded-input border border-border bg-ground p-4">
            {data.agreement.map((section) => (
              <section key={section.heading}>
                <h3 className="text-[15px] font-semibold">{section.heading}</h3>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mt-1 text-[15px] leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
          </div>
          <Checkbox
            className="mt-4"
            label="I agree to this agreement"
            description="Ticking this is your signature."
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
            error={fieldErrors?.agreed?.[0]}
          />
        </Card>
      </div>

      <aside className="lg:sticky lg:top-24" aria-label="Summary">
        <Card>
          <h2 className="font-display text-[20px] font-bold">Summary</h2>
          <p className="mt-2 text-[15px] font-semibold">{data.service.title}</p>
          <p className="text-sm text-muted">{data.business.name}</p>
          {data.price ? (
            <dl className="mt-4 grid gap-1.5 text-[15px]">
              <div className="flex justify-between">
                <dt>{data.terms.pricing === "season" ? "Season price" : "Each visit"}</dt>
                <dd>{formatCad(data.price.priceCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Service fee</dt>
                <dd>{formatCad(data.price.serviceFeeCents)}</dd>
              </div>
              {data.price.taxCents > 0 ? (
                <div className="flex justify-between">
                  <dt>HST</dt>
                  <dd>{formatCad(data.price.taxCents)}</dd>
                </div>
              ) : null}
              <div className="mt-1 flex justify-between border-t border-border pt-2 font-semibold">
                <dt>{data.terms.pricing === "season" ? "Total" : "Per visit"}</dt>
                <dd>{formatCad(data.price.totalCents)}</dd>
              </div>
            </dl>
          ) : null}
          {data.seasonPayment === "monthly" && data.instalments.length > 0 ? (
            <ul className="mt-3 grid gap-1 text-sm text-muted">
              {data.instalments.map((instalment) => (
                <li key={instalment.label} className="flex justify-between gap-2">
                  <span>{instalment.label}</span>
                  <span>
                    {formatCad(instalment.totalCents)}, {instalment.charged}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 border-t border-border pt-4 text-sm">
            {card.isPending ? (
              <Skeleton className="h-6" />
            ) : card.data ? (
              <p className="text-muted">
                Charged to <strong className="text-ink">{card.data.label}</strong>.{" "}
                <a
                  href={`/account/card?next=${encodeURIComponent(returnPath)}`}
                  className="font-semibold text-primary"
                >
                  Change
                </a>
              </p>
            ) : (
              <div className="grid gap-2">
                <p className="text-muted">
                  Contracts are charged to a saved card. Add one first; you&apos;ll come straight
                  back here.
                </p>
                <CardSetupButton returnPath={returnPath} label="Add a card" variant="secondary" />
              </div>
            )}
          </div>
          <p className="mt-3 text-sm text-muted">
            {source.kind === "quote" ? (
              <>
                <strong className="text-ink">Confirmed straight away:</strong> these are the
                pro&apos;s own terms.
              </>
            ) : (
              <>
                <strong className="text-ink">Needs the pro&apos;s OK.</strong> Nothing is charged
                until they accept (within 24 hours).
              </>
            )}
          </p>
          {problem || (sending.error && !fieldErrors) ? (
            <FormAlert tone="error" className="mt-4">
              {problem ?? sending.error?.message}
            </FormAlert>
          ) : null}
          <Button
            type="submit"
            size="lg"
            block
            className="mt-5"
            disabled={sending.isPending || sending.isSuccess || !card.data}
            aria-busy={sending.isPending}
          >
            {sending.isPending || sending.isSuccess ? "Signing up…" : "Sign up"}
            <ArrowRightIcon size={18} />
          </Button>
        </Card>
      </aside>
    </form>
  );
}
