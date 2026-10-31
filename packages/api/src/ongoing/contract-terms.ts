/**
 * Listed snow contract terms and spots left (SPEC §21). Kept apart from the contract
 * flows so listing and search views can read them without pulling those in.
 */
import type { ContractPricing, SeasonBilling } from "@nevile/core";
import {
  and,
  bookings,
  count,
  type DbExecutor,
  eq,
  inArray,
  serviceContractTerms,
} from "@nevile/db";

/** Contract bookings that hold a spot: waiting for the pro, or running. */
export const LIVE_CONTRACT_STATES = ["requested", "confirmed"] as const;

export type ContractListing = {
  triggerCm: number;
  seasonStart: string;
  seasonEnd: string;
  pricing: ContractPricing;
  priceCents: number;
  seasonBilling: SeasonBilling | null;
  spots: number;
  spotsLeft: number;
};

/** Contract terms and spots left for the services that have them, by service id. */
export async function contractTermsFor(
  db: DbExecutor,
  serviceIds: readonly string[],
): Promise<Map<string, ContractListing>> {
  if (serviceIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(serviceContractTerms)
    .where(inArray(serviceContractTerms.serviceId, [...serviceIds]));
  if (rows.length === 0) return new Map();
  const taken = await db
    .select({ serviceId: bookings.serviceId, n: count() })
    .from(bookings)
    .where(
      and(
        inArray(
          bookings.serviceId,
          rows.map((row) => row.serviceId),
        ),
        eq(bookings.kind, "snow_contract"),
        inArray(bookings.status, [...LIVE_CONTRACT_STATES]),
      ),
    )
    .groupBy(bookings.serviceId);
  return new Map(
    rows.map((row) => [
      row.serviceId,
      {
        triggerCm: row.triggerCm,
        seasonStart: row.seasonStart,
        seasonEnd: row.seasonEnd,
        pricing: row.pricing,
        priceCents: row.priceCents,
        seasonBilling: row.seasonBilling,
        spots: row.spots,
        spotsLeft: Math.max(
          0,
          row.spots - (taken.find((entry) => entry.serviceId === row.serviceId)?.n ?? 0),
        ),
      },
    ]),
  );
}

/** Whether a service is listed as a contract (one-off booking is closed for it). */
export async function isContractService(db: DbExecutor, serviceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: serviceContractTerms.serviceId })
    .from(serviceContractTerms)
    .where(eq(serviceContractTerms.serviceId, serviceId));
  return row !== undefined;
}
