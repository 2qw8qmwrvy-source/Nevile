"use client";

import { useMutation } from "@tanstack/react-query";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { CheckIcon, Icon } from "@/components/ui/icons.tsx";
import { useTRPC } from "@/lib/trpc.ts";
import type { SectionProps } from "./listing-dashboard.tsx";
import { sectionTitleClass, useRefreshListing } from "./use-listing.ts";

/** Where each checklist item is fixed. */
const FIX_LINKS: Record<string, string> = {
  verify_contact: "/account",
  name: "#profile",
  about: "#profile",
  service_area: "#area",
  services: "#services",
};

const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" });

/** Publishing (SPEC §18): what's missing, then Publish / Unpublish. */
export function StatusCard({
  listing,
  businessId,
  onPublished,
}: SectionProps & { onPublished: () => void }) {
  const trpc = useTRPC();
  const refresh = useRefreshListing(businessId);
  const publish = useMutation(
    trpc.listing.publish.mutationOptions({
      onSuccess: (result) => {
        if (result.published) onPublished();
        return refresh();
      },
    }),
  );
  const unpublish = useMutation(trpc.listing.unpublish.mutationOptions({ onSuccess: refresh }));
  const { readiness, business, canEdit } = listing;
  const published = business.publishedAt !== null;
  const busy = publish.isPending || unpublish.isPending;

  return (
    <Card as="section" aria-labelledby="status-title">
      <h2 id="status-title" className={sectionTitleClass}>
        {published
          ? "Your listing is live"
          : readiness.ready
            ? "Ready to publish"
            : "Get ready to publish"}
      </h2>
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
        {published
          ? `Customers can find you in search since ${dateFormat.format(business.publishedAt ?? new Date())}.`
          : readiness.ready
            ? "Everything's in place. Publish to appear in search for customers in your area."
            : "Finish these and you can publish. Your changes are saved as you go."}
      </p>
      {readiness.missing.length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {readiness.missing.map((item) => (
            <li key={item.key}>
              <a
                href={FIX_LINKS[item.key] ?? "#profile"}
                className="flex min-h-11 items-center gap-3 rounded-input border border-border bg-ground px-3.5 py-2 text-[15px] font-medium text-ink no-underline hover:border-field"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-6 flex-none items-center justify-center rounded-full border-2 border-field"
                />
                {item.label}
                <Icon name="arrowRight" size={16} className="ml-auto text-muted" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-[15px] font-medium text-primary">
          <CheckIcon size={18} /> Profile, service area and services are all set.
        </p>
      )}
      {publish.data && !publish.data.published ? (
        <FormAlert tone="error" className="mt-4">
          Not yet: {publish.data.missing.map((item) => item.label.toLowerCase()).join("; ")}.
        </FormAlert>
      ) : null}
      {publish.error || unpublish.error ? (
        <FormAlert tone="error" className="mt-4">
          {(publish.error ?? unpublish.error)?.message}
        </FormAlert>
      ) : null}
      {canEdit ? (
        <div className="mt-5 flex flex-wrap gap-3">
          {published ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => unpublish.mutate({ businessId })}
            >
              {unpublish.isPending ? "Hiding…" : "Unpublish"}
            </Button>
          ) : (
            <Button
              disabled={busy || !readiness.ready}
              aria-busy={publish.isPending}
              onClick={() => publish.mutate({ businessId })}
            >
              {publish.isPending ? "Publishing…" : "Publish listing"}
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}
