"use client";

import type { ListingView } from "@nevile/api";
import { useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import { useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ExternalIcon } from "@/components/ui/icons.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useTRPC } from "@/lib/trpc.ts";
import { AreaSection } from "./area-section.tsx";
import { PhotosSection } from "./photos-section.tsx";
import { ProfileSection } from "./profile-section.tsx";
import { ServicesSection } from "./services-section.tsx";
import { StatusCard } from "./status-card.tsx";

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "photos", label: "Photos" },
  { id: "area", label: "Service area" },
  { id: "services", label: "Services" },
] as const;

export type SectionProps = {
  listing: ListingView;
  businessId: string;
  /** Called when a change hid the listing from search (it's no longer ready). */
  onUnpublished: () => void;
};

/** The listing editor: status and checklist first, then each part of the listing. */
export function ListingDashboard({ businessId }: { businessId: string }) {
  const trpc = useTRPC();
  const query = useQuery(trpc.listing.get.queryOptions({ businessId }));
  const [notice, setNotice] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <div role="status" aria-live="polite" className="grid gap-5">
        <span className="sr-only">Loading your listing…</span>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <FormAlert tone="error">
        We couldn&apos;t load your listing.{" "}
        <button type="button" className="font-semibold underline" onClick={() => query.refetch()}>
          Try again
        </button>
      </FormAlert>
    );
  }

  const listing = query.data;
  const published = listing.business.publishedAt !== null;
  const onUnpublished = () =>
    setNotice(
      "That change means your listing isn't ready any more, so it's hidden from search. Fix the items in the checklist and publish again.",
    );
  const sectionProps: SectionProps = { listing, businessId, onUnpublished };

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
      <nav aria-label="Listing sections" className="hidden lg:block">
        <ul className="sticky top-24 grid gap-1">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="flex min-h-11 items-center rounded-input px-3 font-semibold text-ink no-underline hover:bg-hover"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid min-w-0 gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[0.06em] text-primary uppercase">
              Your listing
            </p>
            <h1 className="mt-1 font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] break-words sm:text-[38px]">
              {listing.business.name}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-2">
              {published ? (
                <Badge variant="verified" icon="check">
                  Live in search
                </Badge>
              ) : (
                <Badge variant="neutral">Not published</Badge>
              )}
              {!listing.canEdit ? <Badge variant="neutral">View only</Badge> : null}
            </p>
          </div>
          <Button href={`/pros/${listing.business.slug}` as Route} variant="secondary" size="sm">
            {published ? "View your page" : "Preview your page"}
            <ExternalIcon size={16} />
          </Button>
        </header>
        {notice ? (
          <FormAlert tone="info">
            <span>{notice}</span>{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => setNotice(null)}
            >
              Dismiss
            </button>
          </FormAlert>
        ) : null}
        {!listing.canEdit ? (
          <FormAlert tone="info">
            Only the owner and managers can change the listing. You can see everything here.
          </FormAlert>
        ) : null}
        <StatusCard {...sectionProps} onPublished={() => setNotice(null)} />
        <ProfileSection {...sectionProps} />
        <PhotosSection {...sectionProps} />
        <AreaSection {...sectionProps} />
        <ServicesSection {...sectionProps} />
      </div>
    </div>
  );
}
