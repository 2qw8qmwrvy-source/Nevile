"use client";

import {
  REFERRAL_ADDRESS_LINE_MAX_LENGTH,
  REFERRAL_CITY_MAX_LENGTH,
  REFERRAL_CONTACT_ROUTE_MAX_LENGTH,
  REFERRAL_FIRST_NAME_MAX_LENGTH,
  REFERRAL_NOTES_HINT,
  REFERRAL_NOTES_MAX_LENGTH,
  REFERRAL_TIMING_MAX_LENGTH,
  referralInputSchema,
} from "@nevile/core";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field.tsx";
import { useTRPC } from "@/lib/trpc.ts";

type Option = { id: string; name: string };

type ReferralFormProps = {
  partners: readonly Option[];
  regions: readonly Option[];
  categories: ReadonlyArray<{ slug: string; name: string }>;
};

type Fields = {
  partnerId: string;
  homeownerFirstName: string;
  contactRoute: string;
  addressLine: string;
  city: string;
  postalCode: string;
  regionId: string;
  categorySlug: string;
  preferredTiming: string;
  notes: string;
};

type FieldErrors = Partial<Record<keyof Fields | "consentConfirmed", string>>;

const ORDER: readonly (keyof FieldErrors)[] = [
  "homeownerFirstName",
  "contactRoute",
  "addressLine",
  "city",
  "postalCode",
  "regionId",
  "categorySlug",
  "preferredTiming",
  "notes",
  "consentConfirmed",
];

/**
 * Partner referral (SPEC §15). Only what's needed to do the job: no health, disability,
 * age or income details. The server re-validates everything with the same schema.
 */
export function ReferralForm({ partners, regions, categories }: ReferralFormProps) {
  const trpc = useTRPC();
  const formRef = useRef<HTMLFormElement>(null);
  const empty: Fields = {
    partnerId: partners[0]?.id ?? "",
    homeownerFirstName: "",
    contactRoute: "",
    addressLine: "",
    city: "",
    postalCode: "",
    regionId: "",
    categorySlug: "",
    preferredTiming: "",
    notes: "",
  };
  const [fields, setFields] = useState<Fields>(empty);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const submit = useMutation(trpc.community.submitReferral.mutationOptions());

  function update(key: keyof Fields) {
    return (event: { target: { value: string } }) => {
      setFields((current) => ({ ...current, [key]: event.target.value }));
      if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { partnerId, ...rest } = fields;
    const parsed = referralInputSchema.safeParse({ ...rest, consentConfirmed: consent });
    if (!parsed.success) {
      const found: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors | undefined;
        if (key && !found[key]) {
          found[key] = key === "regionId" || key === "categorySlug" ? "Choose one." : issue.message;
        }
      }
      setErrors(found);
      const first = ORDER.find((key) => found[key]);
      if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setErrors({});
    try {
      await submit.mutateAsync({ ...parsed.data, consentConfirmed: true, partnerId });
    } catch {
      // Shown below via submit.error.
    }
  }

  if (submit.isSuccess) {
    return (
      <Card className="nv-rise">
        <FormAlert tone="success">Thanks, the referral is in.</FormAlert>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          A Nevile admin will review it and contact you through your organization. We&apos;ll only
          share the job details with the pro who does the work.
        </p>
        <Button
          className="mt-4"
          variant="secondary"
          onClick={() => {
            setFields(empty);
            setConsent(false);
            submit.reset();
          }}
        >
          Refer someone else
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <form ref={formRef} method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormAlert tone="info">
          Share only what&apos;s needed to do the job. Please don&apos;t include health, disability,
          age or income details.
        </FormAlert>
        {submit.error ? (
          <FormAlert tone="error">
            {submit.error.message || "We couldn't send the referral. Please try again."}
          </FormAlert>
        ) : null}
        {partners.length > 1 ? (
          <Field label="Referring organization">
            <Select name="partnerId" value={fields.partnerId} onChange={update("partnerId")}>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-[15px]">
            Referring as <strong>{partners[0]?.name}</strong>
          </p>
        )}
        <Field label="Homeowner's first name" error={errors.homeownerFirstName}>
          <Input
            name="homeownerFirstName"
            autoComplete="off"
            maxLength={REFERRAL_FIRST_NAME_MAX_LENGTH}
            value={fields.homeownerFirstName}
            onChange={update("homeownerFirstName")}
          />
        </Field>
        <Field
          label="How to reach them through your organization"
          hint='For example: "Call Mary at the centre, 9 to 4 weekdays".'
          error={errors.contactRoute}
        >
          <Input
            name="contactRoute"
            autoComplete="off"
            maxLength={REFERRAL_CONTACT_ROUTE_MAX_LENGTH}
            value={fields.contactRoute}
            onChange={update("contactRoute")}
          />
        </Field>
        <Field label="Street address" error={errors.addressLine}>
          <Input
            name="addressLine"
            autoComplete="off"
            maxLength={REFERRAL_ADDRESS_LINE_MAX_LENGTH}
            value={fields.addressLine}
            onChange={update("addressLine")}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City or town" error={errors.city}>
            <Input
              name="city"
              autoComplete="off"
              maxLength={REFERRAL_CITY_MAX_LENGTH}
              value={fields.city}
              onChange={update("city")}
            />
          </Field>
          <Field label="Postal code" error={errors.postalCode}>
            <Input
              name="postalCode"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="B3H 1A1"
              maxLength={7}
              value={fields.postalCode}
              onChange={update("postalCode")}
              className="uppercase"
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Region" error={errors.regionId}>
            <Select name="regionId" value={fields.regionId} onChange={update("regionId")}>
              <option value="">Choose a region</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Help needed" error={errors.categorySlug}>
            <Select
              name="categorySlug"
              value={fields.categorySlug}
              onChange={update("categorySlug")}
            >
              <option value="">Choose a service</option>
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Preferred timing (optional)" error={errors.preferredTiming}>
          <Input
            name="preferredTiming"
            autoComplete="off"
            placeholder="For example: mornings, before the first snow"
            maxLength={REFERRAL_TIMING_MAX_LENGTH}
            value={fields.preferredTiming}
            onChange={update("preferredTiming")}
          />
        </Field>
        <Field label="Notes for the pro (optional)" hint={REFERRAL_NOTES_HINT} error={errors.notes}>
          <Textarea
            name="notes"
            maxLength={REFERRAL_NOTES_MAX_LENGTH}
            value={fields.notes}
            onChange={update("notes")}
          />
        </Field>
        <Checkbox
          name="consentConfirmed"
          checked={consent}
          onChange={(event) => {
            setConsent(event.target.checked);
            if (errors.consentConfirmed)
              setErrors((current) => ({ ...current, consentConfirmed: undefined }));
          }}
          label="The homeowner agreed to this referral and to us sharing these details with a Nevile pro."
          error={errors.consentConfirmed}
        />
        <Button type="submit" size="lg" disabled={submit.isPending} aria-busy={submit.isPending}>
          {submit.isPending ? "Sending…" : "Send referral"}
        </Button>
      </form>
    </Card>
  );
}
