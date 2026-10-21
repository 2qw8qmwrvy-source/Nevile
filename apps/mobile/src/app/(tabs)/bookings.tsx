import { router } from "expo-router";

import { Button } from "@/components/button.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { icons } from "@/components/icon.tsx";
import { Screen } from "@/components/screen.tsx";

export default function BookingsScreen() {
  return (
    <Screen title="Bookings">
      <EmptyState
        icon={icons.booked}
        title="No bookings yet"
        message="When you book a local pro, your upcoming visits, recurring plans and receipts will live here."
        action={
          <Button
            label="Find a pro"
            icon={icons.search}
            onPress={() => router.navigate("/search")}
          />
        }
      />
    </Screen>
  );
}
