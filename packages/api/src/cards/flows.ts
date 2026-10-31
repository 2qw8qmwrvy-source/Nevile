/**
 * Saved cards (SPEC §21): the provider's customer record, saving a card on the
 * provider's page (website) or payment sheet (app), and reading it back. Nevile keeps
 * only the brand, last 4 digits and expiry.
 */
import {
  and,
  cardSetups,
  type DbExecutor,
  eq,
  paymentCustomers,
  type SavedCard as SavedCardRow,
  savedCards,
} from "@nevile/db";
import type { ProviderName } from "@nevile/payments";
import { TRPCError } from "@trpc/server";

import type { BookingDeps } from "../bookings/flows.ts";

export type CardDeps = Pick<BookingDeps, "db" | "payments" | "config" | "now">;

/** A website path to come back to: local, no scheme or host. */
export const LOCAL_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/;

const BRAND_NAMES: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  interac: "Interac",
  jcb: "JCB",
  unionpay: "UnionPay",
};

export type CardView = {
  brand: string;
  last4: string;
  /** "Visa •••• 4242" */
  label: string;
  /** "12/29" */
  expires: string;
};

export function cardView(
  card: Pick<SavedCardRow, "brand" | "last4" | "expMonth" | "expYear">,
): CardView {
  const brand = BRAND_NAMES[card.brand] ?? "Card";
  return {
    brand,
    last4: card.last4,
    label: `${brand} •••• ${card.last4}`,
    expires: `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`,
  };
}

/** The person's saved card with this provider, or null. */
export async function savedCardOf(
  db: DbExecutor,
  userId: string,
  provider: ProviderName,
): Promise<SavedCardRow | null> {
  const [card] = await db
    .select()
    .from(savedCards)
    .where(and(eq(savedCards.userId, userId), eq(savedCards.provider, provider)))
    .limit(1);
  return card ?? null;
}

/** The provider's customer record for a person, created on first use. */
export async function paymentCustomerFor(
  deps: CardDeps,
  user: { id: string; email: string | null },
): Promise<string> {
  const provider = deps.payments.name;
  const existing = async () => {
    const [row] = await deps.db
      .select({ customerId: paymentCustomers.customerId })
      .from(paymentCustomers)
      .where(and(eq(paymentCustomers.userId, user.id), eq(paymentCustomers.provider, provider)))
      .limit(1);
    return row?.customerId ?? null;
  };
  const known = await existing();
  if (known) return known;
  const { customerId } = await deps.payments.ensureCustomer({
    userId: user.id,
    email: user.email,
    existingCustomerId: null,
  });
  await deps.db
    .insert(paymentCustomers)
    .values({ userId: user.id, provider, customerId })
    .onConflictDoNothing();
  // A concurrent request may have stored its own first; use whatever is stored.
  return (await existing()) ?? customerId;
}

export type StartedCardSetup =
  | { kind: "page"; setupId: string; url: string }
  | {
      kind: "intent";
      setupId: string;
      clientSecret: string;
      provider: ProviderName;
      publishableKey: string | null;
    };

/** Opens the provider's card form: its page (website) or the app's payment sheet. */
export async function startCardSetup(
  deps: CardDeps,
  user: { id: string; email: string | null },
  input: { kind: "page" | "intent"; returnPath?: string | null },
): Promise<StartedCardSetup> {
  const returnPath =
    input.returnPath && LOCAL_PATH.test(input.returnPath) ? input.returnPath : null;
  const customerId = await paymentCustomerFor(deps, user);
  const [setup] = await deps.db
    .insert(cardSetups)
    .values({ userId: user.id, provider: deps.payments.name, kind: input.kind, returnPath })
    .returning({ id: cardSetups.id });
  if (!setup) throw new Error("card setup insert returned nothing");
  try {
    if (input.kind === "page") {
      const page = await deps.payments.createCardSetupPage({
        reference: setup.id,
        customerId,
        successUrl: `${deps.config.siteUrl}/account/card/return?setup=${setup.id}`,
        cancelUrl: `${deps.config.siteUrl}${returnPath ?? "/account/card"}`,
      });
      await deps.db
        .update(cardSetups)
        .set({ providerSetupId: page.id })
        .where(eq(cardSetups.id, setup.id));
      return { kind: "page", setupId: setup.id, url: page.url };
    }
    if (deps.payments.name === "stripe" && !deps.config.stripePublishableKey) {
      throw new Error("STRIPE_PUBLISHABLE_KEY is not set");
    }
    const intent = await deps.payments.createCardSetupIntent({ reference: setup.id, customerId });
    await deps.db
      .update(cardSetups)
      .set({ providerSetupId: intent.id })
      .where(eq(cardSetups.id, setup.id));
    return {
      kind: "intent",
      setupId: setup.id,
      clientSecret: intent.clientSecret,
      provider: deps.payments.name,
      publishableKey: deps.payments.name === "stripe" ? deps.config.stripePublishableKey : null,
    };
  } catch (error) {
    await deps.db.update(cardSetups).set({ status: "expired" }).where(eq(cardSetups.id, setup.id));
    console.error("[cards] could not open the card form", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "We couldn't open the card form. Please try again.",
    });
  }
}

export type FinishedCardSetup = {
  status: "saved" | "pending" | "expired" | "unknown";
  card: CardView | null;
  returnPath: string | null;
};

/**
 * Stores the card a setup saved, once the provider says it's done (the return page, the
 * app, or the webhook, whichever comes first). Calls `onSaved` after a new card is stored.
 */
export async function finishCardSetup(
  deps: CardDeps,
  setupId: string,
  options: { userId?: string; onSaved?: (userId: string) => Promise<void> } = {},
): Promise<FinishedCardSetup> {
  const [setup] = await deps.db
    .select()
    .from(cardSetups)
    .where(eq(cardSetups.id, setupId))
    .limit(1);
  if (!setup || (options.userId && setup.userId !== options.userId) || !setup.providerSetupId) {
    return { status: "unknown", card: null, returnPath: null };
  }
  const current = async () => {
    const card = await savedCardOf(deps.db, setup.userId, setup.provider);
    return card ? cardView(card) : null;
  };
  if (setup.status === "completed") {
    return { status: "saved", card: await current(), returnPath: setup.returnPath };
  }
  if (setup.provider !== deps.payments.name) {
    return { status: "expired", card: null, returnPath: setup.returnPath };
  }
  const state = await deps.payments.getCardSetup({ kind: setup.kind, id: setup.providerSetupId });
  if (state.status === "expired") {
    await deps.db
      .update(cardSetups)
      .set({ status: "expired" })
      .where(and(eq(cardSetups.id, setup.id), eq(cardSetups.status, "open")));
    return { status: "expired", card: null, returnPath: setup.returnPath };
  }
  if (state.status !== "complete" || !state.card) {
    return { status: "pending", card: null, returnPath: setup.returnPath };
  }
  const card = state.card;
  const saved = await deps.db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(cardSetups)
      .set({ status: "completed", completedAt: deps.now() })
      .where(and(eq(cardSetups.id, setup.id), eq(cardSetups.status, "open")))
      .returning({ id: cardSetups.id });
    if (!claimed) return false;
    const [customer] = await tx
      .select({ customerId: paymentCustomers.customerId })
      .from(paymentCustomers)
      .where(
        and(
          eq(paymentCustomers.userId, setup.userId),
          eq(paymentCustomers.provider, setup.provider),
        ),
      );
    const values = {
      customerId: customer?.customerId ?? "",
      paymentMethodId: card.paymentMethodId,
      brand: card.brand,
      last4: /^[0-9]{4}$/.test(card.last4) ? card.last4 : "0000",
      expMonth: Math.min(12, Math.max(1, card.expMonth || 1)),
      expYear: card.expYear,
    };
    await tx
      .insert(savedCards)
      .values({ userId: setup.userId, provider: setup.provider, ...values })
      .onConflictDoUpdate({
        target: [savedCards.userId, savedCards.provider],
        set: { ...values, updatedAt: deps.now() },
      });
    return true;
  });
  if (saved && options.onSaved) await options.onSaved(setup.userId);
  return { status: "saved", card: await current(), returnPath: setup.returnPath };
}

/** Finishes the setup a provider webhook reports, if it's one of ours. */
export async function finishCardSetupFromProvider(
  deps: CardDeps,
  providerSetupId: string,
  onSaved?: (userId: string) => Promise<void>,
): Promise<void> {
  const [setup] = await deps.db
    .select({ id: cardSetups.id })
    .from(cardSetups)
    .where(eq(cardSetups.providerSetupId, providerSetupId))
    .limit(1);
  if (setup) await finishCardSetup(deps, setup.id, { onSaved });
}
