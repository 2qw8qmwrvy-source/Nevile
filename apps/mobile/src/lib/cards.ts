/**
 * The customer's saved card (SPEC §21): recurring visits and snow contracts are charged to
 * it later, so it's saved once with the payment provider. With Stripe the payment sheet
 * saves it; with the test provider (development) the app's test card screen does.
 */
import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo } from "react-native";

import { presentCardSetupSheet } from "./payments.ts";
import { useTRPC, useTRPCClient } from "./trpc.tsx";
import { apiErrorMessage } from "./trpc-client.ts";

export type SavedCard = NonNullable<inferRouterOutputs<AppRouter>["cards"]["get"]>;
type FinishedSetup = inferRouterOutputs<AppRouter>["cards"]["finishSetup"];

/** Stores a newly saved card in the cache; a paused series or contract may have resumed. */
export function useCardStored() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return (card: SavedCard | null) => {
    queryClient.setQueryData(trpc.cards.get.queryKey(), card);
    void queryClient.invalidateQueries({ queryKey: trpc.bookings.pathKey() });
    AccessibilityInfo.announceForAccessibility(
      card ? `${card.label} saved.` : "Your card is saved.",
    );
  };
}

/** What to tell the customer when a finished card form didn't save a card. */
export function setupProblem(finished: FinishedSetup): string | null {
  switch (finished.status) {
    case "saved":
      return null;
    case "pending":
      return "We're still confirming your card. It shows here in a moment.";
    case "expired":
      return "That card form timed out. Please try again.";
    default:
      return "Something went wrong saving your card. Please try again.";
  }
}

/** Opens the card form and saves the card. */
export function useSaveCard() {
  const client = useTRPCClient();
  const stored = useCardStored();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const setup = await client.cards.startSetup.mutate({ kind: "intent" });
      if (setup.kind !== "intent") throw new Error("expected an in-app card setup");
      if (setup.provider !== "stripe") {
        router.push({ pathname: "/card-test", params: { setupId: setup.setupId } });
        return;
      }
      const result = await presentCardSetupSheet(setup);
      if (result.kind === "canceled") return;
      if (result.kind === "failed") {
        setProblem(result.message);
        return;
      }
      // The provider's webhook can land a moment after the sheet closes.
      let finished = await client.cards.finishSetup.mutate({ setupId: setup.setupId });
      for (let attempt = 0; finished.status === "pending" && attempt < 4; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        finished = await client.cards.finishSetup.mutate({ setupId: setup.setupId });
      }
      if (finished.status === "saved") stored(finished.card);
      setProblem(setupProblem(finished));
    } catch (error) {
      setProblem(apiErrorMessage(error, "We couldn't open the card form. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return { save: () => void save(), busy, problem };
}
