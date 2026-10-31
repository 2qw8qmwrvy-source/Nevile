import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";

import { openPath } from "@/lib/app-links.ts";
import { useSession } from "@/lib/auth.ts";
import { pathOf, refreshPushRegistration } from "@/lib/push.ts";
import { useTRPC, useTRPCClient } from "@/lib/trpc.tsx";

/**
 * Keeps this phone registered for pushes while someone is signed in, opens the screen a
 * tapped notification points to, and refreshes the inbox when one arrives (SPEC §20).
 */
export function PushBridge() {
  const client = useTRPCClient();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (userId) void refreshPushRegistration(client);
  }, [userId, client]);

  useEffect(() => {
    const path = pathOf(response ?? null);
    if (!path || !userId) return;
    // Handled once: don't reopen it when this component mounts again.
    Notifications.clearLastNotificationResponse();
    openPath(path);
  }, [response, userId]);

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: trpc.chat.unread.queryKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.chat.conversations.queryKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.quotes.list.queryKey() });
    });
    return () => subscription.remove();
  }, [queryClient, trpc]);

  return null;
}
