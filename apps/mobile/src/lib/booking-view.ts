/**
 * The booking screen books either a pro's fixed-price service or an accepted quote
 * (SPEC §19, §20). Both API answers are turned into one shape here.
 */
import type { AppRouter, inferRouterOutputs } from "@nevile/api";

type Outputs = inferRouterOutputs<AppRouter>;
type ServiceAvailability = Outputs["bookings"]["availability"];
type QuoteOptions = Outputs["quotes"]["bookingOptions"];

export type BookingSource =
  | { kind: "service"; serviceId: string }
  | { kind: "quote"; quoteId: string };

export type BookingView = {
  title: string;
  businessName: string;
  duration: string;
  /** Confirmed on payment (Instant Book or a quote); otherwise the card is held. */
  instantBook: boolean;
  cancellationPolicy: { label: string; description: string };
  price: { priceCents: number; serviceFeeCents: number; taxCents: number; totalCents: number };
  bookingOpen: boolean;
  /** Quotes: the address must be in this postal code area. */
  postalArea: string | null;
  firstDate: string;
  lastDate: string;
  days: ServiceAvailability["days"];
};

export function serviceView(data: ServiceAvailability): BookingView {
  return {
    title: data.service.title,
    businessName: data.business.name,
    duration: data.service.duration,
    instantBook: data.instantBook,
    cancellationPolicy: data.cancellationPolicy,
    price: data.price,
    bookingOpen: data.bookingOpen,
    postalArea: null,
    firstDate: data.firstDate,
    lastDate: data.lastDate,
    days: data.days,
  };
}

export function quoteView(data: QuoteOptions): BookingView | null {
  if (!data.quote) return null;
  return {
    title: data.title,
    businessName: data.business.name,
    duration: data.quote.duration,
    instantBook: true,
    cancellationPolicy: data.cancellationPolicy,
    price: { priceCents: data.quote.priceCents, ...data.quote.total },
    bookingOpen: data.bookingOpen,
    postalArea: data.postalArea,
    firstDate: data.firstDate,
    lastDate: data.lastDate,
    days: data.days,
  };
}
