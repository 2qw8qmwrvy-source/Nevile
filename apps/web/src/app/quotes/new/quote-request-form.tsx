"use client";

import {
  isLaunchPostalCode,
  QUOTE_REQUEST_LIMITS,
  QUOTE_TIMINGS,
  type QuoteTiming,
} from "@nevile/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { PrivatePhotoPicker, type UploadedPhoto } from "@/components/photos/private-photos.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Field, Input, Select, Textarea } from "@/components/ui/field.tsx";
import { useTRPC } from "@/lib/trpc.ts";

type Props = {
  categories: ReadonlyArray<{ slug: string; name: string }>;
  initialCategory: string;
  initialPostal: string;
  initialPros: string[];
};

export function QuoteRequestForm({
  categories,
  initialCategory,
  initialPostal,
  initialPros,
}: Props) {
  const trpc = useTRPC();
  const router = useRouter();
  const [categorySlug, setCategorySlug] = useState(initialCategory);
  const [postalCode, setPostalCode] = useState(initialPostal);
  const [pros, setPros] = useState(initialPros);
  const [details, setDetails] = useState("");
  const [timing, setTiming] = useState<QuoteTiming | null>(null);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const postalOk = isLaunchPostalCode(postalCode);

  const targets = useQuery({
    ...trpc.quotes.targets.queryOptions({
      categorySlug: categorySlug as "lawn-mowing",
      postalCode,
      businessIds: pros,
    }),
    enabled: postalOk && pros.length > 0 && categorySlug !== "",
  });
  const send = useMutation(
    trpc.quotes.request.mutationOptions({
      onSuccess: ({ groupId }) => router.push(`/quotes/${groupId}?new=1` as Route),
    }),
  );
  const fieldErrors = send.error?.data?.zodError?.fieldErrors as
    | Record<string, string[] | undefined>
    | undefined;
  const blocked = targets.data?.pros.some((pro) => pro.problem) ?? false;
  const searchHref =
    `/search?${new URLSearchParams({ service: categorySlug, postal: postalCode })}` as Route;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (pros.length === 0) return setProblem("Pick at least one pro from search.");
    if (!postalOk) return setProblem("Enter a Nova Scotia postal code like B3H 1A1.");
    if (details.trim().length < QUOTE_REQUEST_LIMITS.detailsMinLength) {
      return setProblem("Describe the job in a sentence or two (at least 20 characters).");
    }
    if (!timing) return setProblem("Pick when you'd like it done.");
    if (blocked) return setProblem("Remove the pros that can't be asked, then send.");
    send.mutate({
      categorySlug: categorySlug as "lawn-mowing",
      businessIds: pros,
      details,
      postalCode,
      timing,
      photoIds: photos.map((photo) => photo.id),
    });
  }

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="mt-6 grid max-w-3xl gap-6">
      <Card as="section" aria-labelledby="who-title" className="grid gap-4">
        <h2 id="who-title" className="font-display text-[20px] font-bold">
          Who you're asking
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Service">
            <Select value={categorySlug} onChange={(event) => setCategorySlug(event.target.value)}>
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Postal code of the job"
            hint="Nova Scotia only. Pros see the area, not your address."
          >
            <Input
              value={postalCode}
              maxLength={7}
              autoComplete="postal-code"
              autoCapitalize="characters"
              className="uppercase"
              onChange={(event) => setPostalCode(event.target.value)}
            />
          </Field>
        </div>
        {pros.length === 0 ? (
          <p className="text-[15px]">
            Pick up to 3 pros from{" "}
            <Link href={searchHref} className="font-semibold text-primary">
              search results
            </Link>
            , then come back here.
          </p>
        ) : targets.isError ? (
          <FormAlert tone="error">{targets.error.message}</FormAlert>
        ) : (
          <ul className="grid gap-2" aria-label="Pros">
            {(
              targets.data?.pros ??
              pros.map((id) => ({ id, name: "Loading…", slug: "", problem: null }))
            ).map((pro) => (
              <li
                key={pro.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-input border border-border bg-ground px-3.5 py-2.5"
              >
                <span>
                  <span className="font-semibold">{pro.name}</span>
                  {pro.problem ? (
                    <span className="block text-sm text-danger">{pro.problem}</span>
                  ) : null}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${pro.name}`}
                  onClick={() => setPros((current) => current.filter((id) => id !== pro.id))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {pros.length > 0 && pros.length < QUOTE_REQUEST_LIMITS.maxPros ? (
          <p className="text-sm text-muted">
            You can ask {QUOTE_REQUEST_LIMITS.maxPros - pros.length} more{" "}
            <Link
              href={`${searchHref}&quote=${pros.join(",")}` as Route}
              className="font-semibold text-primary"
            >
              from search
            </Link>
            .
          </p>
        ) : null}
      </Card>

      <Card as="section" aria-labelledby="job-title" className="grid gap-4">
        <h2 id="job-title" className="font-display text-[20px] font-bold">
          The job
        </h2>
        <Field
          label="Describe the job"
          hint={`What needs doing, roughly how big, anything the pro should know. ${details.trim().length}/${QUOTE_REQUEST_LIMITS.detailsMaxLength}`}
          error={fieldErrors?.details?.[0]}
        >
          <Textarea
            rows={5}
            maxLength={QUOTE_REQUEST_LIMITS.detailsMaxLength}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
          />
        </Field>
        <fieldset>
          <legend className="mb-2 ml-0.5 text-[13px] font-semibold">
            When would you like it done?
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {QUOTE_TIMINGS.map((option) => (
              <label
                key={option.value}
                className="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-input border border-border px-3.5 text-[15px] font-semibold has-checked:border-primary has-checked:bg-primary-soft"
              >
                <input
                  type="radio"
                  name="timing"
                  value={option.value}
                  checked={timing === option.value}
                  onChange={() => setTiming(option.value)}
                  className="size-4 accent-primary"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <p className="mb-2 ml-0.5 text-[13px] font-semibold">Photos (optional, up to 6)</p>
          <PrivatePhotoPicker
            purpose="quotes"
            photos={photos}
            onChange={setPhotos}
            max={QUOTE_REQUEST_LIMITS.maxPhotos}
          />
          <p className="mt-1.5 ml-0.5 text-sm text-muted">
            Only the pros you ask can see them. Location data is removed.
          </p>
        </div>
      </Card>

      {problem || (send.error && !fieldErrors) ? (
        <FormAlert tone="error">{problem ?? send.error?.message}</FormAlert>
      ) : null}
      <div>
        <Button type="submit" size="lg" disabled={send.isPending || send.isSuccess}>
          {send.isPending || send.isSuccess
            ? "Sending…"
            : pros.length > 1
              ? `Ask ${pros.length} pros for a quote`
              : "Ask for a quote"}
        </Button>
      </div>
    </form>
  );
}
