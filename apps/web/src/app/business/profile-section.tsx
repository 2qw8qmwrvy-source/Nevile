"use client";

import {
  BUSINESS_NAME_MAX_LENGTH,
  CANCELLATION_POLICIES,
  CANCELLATION_POLICY_IDS,
  type CancellationPolicyId,
  LISTING_ABOUT_MAX_LENGTH,
  LISTING_ABOUT_MIN_LENGTH,
} from "@nevile/core";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field.tsx";
import { cn } from "@/lib/cn.ts";
import { useTRPC } from "@/lib/trpc.ts";
import type { SectionProps } from "./listing-dashboard.tsx";
import { fieldError, sectionTitleClass, useRefreshListing } from "./use-listing.ts";

/** Name, about, tax registration, cancellation preset and Instant Book (SPEC §18). */
export function ProfileSection({ listing, businessId, onUnpublished }: SectionProps) {
  const trpc = useTRPC();
  const refresh = useRefreshListing(businessId);
  const { business, canEdit } = listing;
  const [name, setName] = useState(business.name);
  const [description, setDescription] = useState(business.description);
  const [gstHstNumber, setGstHstNumber] = useState(business.gstHstNumber ?? "");
  const [policy, setPolicy] = useState<CancellationPolicyId>(business.cancellationPolicy);
  const [instantBook, setInstantBook] = useState(business.instantBook);
  const [takesQuotes, setTakesQuotes] = useState(business.acceptsQuoteRequests);
  const [saved, setSaved] = useState(false);

  const save = useMutation(
    trpc.listing.updateProfile.mutationOptions({
      onSuccess: async (result) => {
        setSaved(true);
        if (result.unpublished) onUnpublished();
        await refresh();
      },
    }),
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    save.mutate({
      businessId,
      name,
      description,
      gstHstNumber,
      cancellationPolicy: policy,
      instantBook,
      acceptsQuoteRequests: takesQuotes,
    });
  }

  const aboutLength = description.trim().length;
  const formError = save.error && !save.error.data?.zodError ? save.error.message : null;

  return (
    <Card as="section" id="profile" aria-labelledby="profile-title" className="scroll-mt-24">
      <h2 id="profile-title" className={sectionTitleClass}>
        Profile
      </h2>
      <p className="mt-1.5 text-[15px] text-muted">What customers see at the top of your page.</p>
      <form method="post" onSubmit={onSubmit} noValidate className="mt-5 grid gap-5">
        <fieldset disabled={!canEdit || save.isPending} className="grid gap-5">
          <Field label="Business name" error={fieldError(save.error, "name")}>
            <Input
              name="name"
              value={name}
              maxLength={BUSINESS_NAME_MAX_LENGTH}
              autoComplete="organization"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="About your business"
            hint={`${aboutLength} / ${LISTING_ABOUT_MAX_LENGTH} characters${
              aboutLength < LISTING_ABOUT_MIN_LENGTH
                ? ` · at least ${LISTING_ABOUT_MIN_LENGTH} to publish`
                : ""
            }. Say what you do, where, and what makes you good at it.`}
            error={fieldError(save.error, "description")}
          >
            <Textarea
              name="description"
              rows={5}
              value={description}
              maxLength={LISTING_ABOUT_MAX_LENGTH}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field
            label="GST/HST number (optional)"
            hint="Only if you're registered: HST is then added to your price at checkout. Leave it empty if you're not registered."
            error={fieldError(save.error, "gstHstNumber")}
          >
            <Input
              name="gstHstNumber"
              placeholder="123456789 RT 0001"
              value={gstHstNumber}
              maxLength={20}
              autoCapitalize="characters"
              onChange={(event) => setGstHstNumber(event.target.value)}
            />
          </Field>
          <fieldset>
            <legend className="mb-1.5 ml-0.5 text-[13px] font-semibold">Cancellation policy</legend>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {CANCELLATION_POLICY_IDS.map((id) => {
                const option = CANCELLATION_POLICIES[id];
                return (
                  <label
                    key={id}
                    className={cn(
                      "flex cursor-pointer flex-col gap-1 rounded-input border px-3.5 py-3 transition-colors",
                      policy === id
                        ? "border-primary bg-primary-soft"
                        : "border-border hover:border-field",
                    )}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <input
                        type="radio"
                        name="cancellationPolicy"
                        value={id}
                        checked={policy === id}
                        onChange={() => setPolicy(id)}
                        className="size-4 accent-primary"
                      />
                      {option.label}
                    </span>
                    <span className="text-sm leading-snug text-muted">{option.description}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <Checkbox
            name="instantBook"
            checked={instantBook}
            onChange={(event) => setInstantBook(event.target.checked)}
            label="Instant Book"
            description="Customers can book your fixed-price services straight away, without waiting for you to accept. You can switch it off for single services."
          />
          <Checkbox
            name="acceptsQuoteRequests"
            checked={takesQuotes}
            onChange={(event) => setTakesQuotes(event.target.checked)}
            label="Take quote requests"
            description="Customers can describe a job and ask you for a price, from your page and from search. You reply within 3 days with a quote, or decline."
          />
        </fieldset>
        {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}
        {saved && !save.isPending ? <FormAlert tone="success">Profile saved.</FormAlert> : null}
        {canEdit ? (
          <div>
            <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
              {save.isPending ? "Saving…" : "Save profile"}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
