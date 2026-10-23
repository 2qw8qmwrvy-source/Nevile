import { formatDurationMinutes } from "@nevile/core";
import { TRPCError } from "@trpc/server";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ProAvatar } from "@/components/pros/pro-avatar.tsx";
import { ProBadges } from "@/components/pros/pro-badges.tsx";
import { Rating } from "@/components/pros/rating.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Container } from "@/components/ui/container.tsx";
import { CalendarIcon, ClockIcon, InfoIcon, PinIcon, StarIcon } from "@/components/ui/icons.tsx";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { AreaMap } from "./area-map.tsx";

type ProPageProps = { params: Promise<{ slug: string }> };

const loadProfile = cache(async (slug: string) => {
  const caller = await getServerCaller();
  try {
    return await caller.search.profile({ slug });
  } catch (error) {
    if (
      error instanceof TRPCError &&
      (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST")
    ) {
      return null;
    }
    throw error;
  }
});

export async function generateMetadata({ params }: ProPageProps): Promise<Metadata> {
  const profile = await loadProfile((await params).slug);
  if (!profile) return { title: "Pro not found", robots: { index: false } };
  return {
    title: profile.name,
    description: profile.about.slice(0, 160),
    robots: { index: !profile.preview },
  };
}

const monthYear = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric" });
const reviewDate = new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric" });

/** A business's public page (SPEC §18). Contact details stay hidden until booking (§7). */
export default async function ProPage({ params }: ProPageProps) {
  const profile = await loadProfile((await params).slug);
  if (!profile) notFound();
  // Members previewing their own page can't book themselves.
  const canBook = profile.bookingOpen && !profile.preview;
  const firstBookable = profile.services.find((service) => service.bookable);

  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      {profile.preview ? (
        <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-season-tint bg-season-tint/60 px-4 py-3 text-[15px]">
          <InfoIcon size={18} className="flex-none text-season-ink" />
          <span className="min-w-0 flex-1">
            <strong className="font-semibold">Preview.</strong> Only your team can see this page
            until you publish your listing.
          </span>
          <Button href="/business" size="sm" variant="secondary">
            Back to your listing
          </Button>
        </p>
      ) : null}

      <section
        aria-labelledby="pro-name"
        className="rounded-panel bg-primary-soft px-4.5 py-7 sm:rounded-hero sm:px-10 sm:py-9"
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <ProAvatar name={profile.name} logoUrl={profile.logoUrl} size="lg" tone="surface" />
          <div className="min-w-0">
            <h1
              id="pro-name"
              className="font-display text-[32px] leading-[1.08] font-extrabold tracking-[-0.03em] text-balance break-words sm:text-[40px]"
            >
              {profile.name}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Rating rating={profile.rating} />
              <ProBadges badges={profile.badges} />
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-muted">
              {profile.area ? (
                <span className="inline-flex items-center gap-1.5">
                  <PinIcon size={16} />
                  {profile.area.description}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon size={16} />
                On Nevile since {monthYear.format(profile.memberSince)}
              </span>
            </p>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="grid gap-6">
          <Card as="section" aria-labelledby="about-title">
            <h2 id="about-title" className="font-display text-[22px] font-bold tracking-[-0.02em]">
              About
            </h2>
            <p className="mt-3 text-[16px] leading-relaxed whitespace-pre-line">{profile.about}</p>
          </Card>

          {profile.photos.length > 0 ? (
            <section aria-labelledby="photos-title">
              <h2
                id="photos-title"
                className="font-display text-[22px] font-bold tracking-[-0.02em]"
              >
                Recent work
              </h2>
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {profile.photos.map((photo) => (
                  <li
                    key={photo.id}
                    className="overflow-hidden rounded-card border border-border bg-subtle"
                  >
                    {/* biome-ignore lint/performance/noImgElement: media is already resized WebP. */}
                    <img
                      src={photo.url}
                      alt={photo.altText || `Work by ${profile.name}`}
                      width={photo.width}
                      height={photo.height}
                      loading="lazy"
                      decoding="async"
                      className="aspect-[4/3] h-auto w-full object-cover"
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="services-title">
            <h2
              id="services-title"
              className="font-display text-[22px] font-bold tracking-[-0.02em]"
            >
              Services
            </h2>
            <ul className="mt-3 grid gap-3">
              {profile.services.map((service) => (
                <li key={service.id}>
                  <Card padding="sm" className="sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                      <div className="min-w-0">
                        <h3 className="text-[17px] leading-snug font-semibold">{service.title}</h3>
                        <p className="text-sm text-muted">{service.categoryName}</p>
                      </div>
                      <p className="text-[17px] font-semibold whitespace-nowrap">
                        {service.priceText}
                      </p>
                    </div>
                    {service.description ? (
                      <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line text-ink">
                        {service.description}
                      </p>
                    ) : null}
                    <p className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                      <span className="inline-flex items-center gap-1">
                        <ClockIcon size={15} />
                        About {formatDurationMinutes(service.durationMinutes)}
                      </span>
                      {service.instantBook ? <Badge variant="instant" /> : null}
                    </p>
                    {canBook && service.bookable ? (
                      <Button
                        href={`/pros/${profile.slug}/book?service=${service.id}` as Route}
                        size="sm"
                        className="mt-3"
                      >
                        Book
                      </Button>
                    ) : !service.bookable ? (
                      <p className="mt-3 text-sm text-muted">Quotes open on Nevile soon.</p>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="reviews-title">
            <h2
              id="reviews-title"
              className="font-display text-[22px] font-bold tracking-[-0.02em]"
            >
              Reviews
            </h2>
            {profile.reviews.length === 0 ? (
              <p className="mt-2 text-[15px] text-muted">
                No reviews yet. Reviews appear here after customers' jobs are done.
              </p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {profile.reviews.map((review) => (
                  <li key={review.id}>
                    <Card padding="sm" className="sm:p-5">
                      <p className="flex flex-wrap items-center gap-x-2 text-sm">
                        <span className="sr-only">{review.stars} out of 5 stars.</span>
                        <span aria-hidden="true" className="inline-flex text-star">
                          {Array.from({ length: 5 }, (_, index) => (
                            <StarIcon
                              // biome-ignore lint/suspicious/noArrayIndexKey: fixed five stars.
                              key={index}
                              size={16}
                              className={index < review.stars ? "fill-star" : "text-border"}
                            />
                          ))}
                        </span>
                        <span className="font-semibold">{review.author}</span>
                        <span className="text-muted">{reviewDate.format(review.createdAt)}</span>
                      </p>
                      {review.comment ? (
                        <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line">
                          {review.comment}
                        </p>
                      ) : null}
                      {review.reply ? (
                        <p className="mt-3 rounded-input bg-ground px-3.5 py-2.5 text-[15px] leading-relaxed">
                          <span className="font-semibold">Reply from {profile.name}: </span>
                          {review.reply}
                        </p>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="grid gap-5 lg:sticky lg:top-24" aria-label="Booking and service area">
          <Card>
            <h2 className="font-display text-[20px] font-bold tracking-[-0.02em]">
              Book {profile.name}
            </h2>
            {firstBookable && canBook ? (
              <>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">
                  Pick a day and an arrival window, then pay securely through Nevile. The pro&apos;s
                  contact details are shared once your booking is paid.
                </p>
                <Button
                  href={`/pros/${profile.slug}/book?service=${firstBookable.id}` as Route}
                  block
                  size="lg"
                  className="mt-4"
                >
                  Book a time
                </Button>
              </>
            ) : (
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                {firstBookable
                  ? `${profile.name} isn't taking new bookings right now. Please check back soon.`
                  : "This pro works by quote. Quotes open on Nevile soon."}
              </p>
            )}
          </Card>
          {profile.area ? (
            <Card>
              <h2 className="font-display text-[20px] font-bold tracking-[-0.02em]">
                Service area
              </h2>
              <p className="mt-1.5 text-[15px] text-muted">{profile.area.description}</p>
              <AreaMap
                center={profile.area.center}
                radiusKm={profile.area.radiusKm}
                name={profile.name}
              />
            </Card>
          ) : null}
          <Card>
            <h2 className="font-display text-[20px] font-bold tracking-[-0.02em]">
              {profile.cancellationPolicy.label} cancellation
            </h2>
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
              {profile.cancellationPolicy.description}
            </p>
          </Card>
        </aside>
      </div>
    </Container>
  );
}
