"use client";

import type { Dispatch, SetStateAction } from "react";
import { Card } from "@/components/ui/card.tsx";
import { Field, Input, Textarea } from "@/components/ui/field.tsx";

export type JobAddress = { line1: string; line2: string; city: string; postalCode: string };

type AddressCardProps = {
  hint: string;
  address: JobAddress;
  onAddress: Dispatch<SetStateAction<JobAddress>>;
  notes: string;
  onNotes: (notes: string) => void;
  error?: string;
};

/** Where the job is (Nova Scotia only), plus notes for the pro. */
export function AddressCard({ hint, address, onAddress, notes, onNotes, error }: AddressCardProps) {
  const set = (key: keyof JobAddress) => (value: string) =>
    onAddress((current) => ({ ...current, [key]: value }));
  return (
    <Card as="section" aria-labelledby="where-title">
      <h2 id="where-title" className="font-display text-[20px] font-bold">
        Where
      </h2>
      <p className="mt-1 text-[15px] text-muted">{hint}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Street address" error={error} className="sm:col-span-2">
          <Input
            autoComplete="address-line1"
            value={address.line1}
            maxLength={120}
            onChange={(event) => set("line1")(event.target.value)}
          />
        </Field>
        <Field label="Apartment or unit (optional)">
          <Input
            autoComplete="address-line2"
            value={address.line2}
            maxLength={120}
            onChange={(event) => set("line2")(event.target.value)}
          />
        </Field>
        <Field label="Town or city">
          <Input
            autoComplete="address-level2"
            value={address.city}
            maxLength={80}
            onChange={(event) => set("city")(event.target.value)}
          />
        </Field>
        <Field label="Postal code" hint="Nova Scotia only (starts with B).">
          <Input
            autoComplete="postal-code"
            autoCapitalize="characters"
            className="uppercase"
            maxLength={7}
            value={address.postalCode}
            onChange={(event) => set("postalCode")(event.target.value)}
          />
        </Field>
        <Field
          label="Notes for the pro (optional)"
          hint="Gate codes, pets, where to park."
          className="sm:col-span-2"
        >
          <Textarea
            rows={3}
            maxLength={500}
            value={notes}
            onChange={(event) => onNotes(event.target.value)}
          />
        </Field>
      </div>
    </Card>
  );
}

/** A friendly reason the address can't be sent yet, or null. */
export function addressProblem(address: JobAddress, postalAreaOf: (code: string) => string | null) {
  if (!address.line1.trim() || !address.city.trim()) return "Enter the street address and town.";
  if (!postalAreaOf(address.postalCode)) return "Enter a postal code like B3H 1A1.";
  return null;
}
