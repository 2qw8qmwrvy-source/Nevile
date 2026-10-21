import { router } from "expo-router";

import { Button } from "@/components/button.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { icons } from "@/components/icon.tsx";
import { Screen } from "@/components/screen.tsx";
import { seasons } from "@/theme";

export default function InboxScreen() {
  return (
    <Screen title="Inbox">
      <EmptyState
        icon={icons.chat}
        tint={seasons.winter.tint}
        iconColor={seasons.winter.accent}
        title="No messages yet"
        message="Chat opens as soon as you send a request. Phone numbers and emails are shared once a booking is paid."
        action={
          <Button label="Browse services" variant="secondary" onPress={() => router.navigate("/search")} />
        }
      />
    </Screen>
  );
}
