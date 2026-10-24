import { useQuery } from "@tanstack/react-query";
import { Tabs } from "expo-router/js-tabs";
import type { ColorValue } from "react-native";

import { Icon, type IconName, icons } from "@/components/icon.tsx";
import { TabBar } from "@/components/tab-bar.tsx";
import { useSession } from "@/lib/auth.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { colors } from "@/theme";

function tabIcon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Icon name={name} size={size} color={color} />
  );
}

export default function TabsLayout() {
  const trpc = useTRPC();
  const session = useSession();
  const unread = useQuery({
    ...trpc.chat.unread.queryOptions(),
    enabled: Boolean(session.data?.user),
    refetchInterval: 60_000,
  });
  const inboxCount = (unread.data?.conversations ?? 0) + (unread.data?.notifications ?? 0);
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.ground } }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon(icons.home) }} />
      <Tabs.Screen name="search" options={{ title: "Search", tabBarIcon: tabIcon(icons.search) }} />
      <Tabs.Screen
        name="bookings"
        options={{ title: "Bookings", tabBarIcon: tabIcon(icons.bookings) }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Inbox",
          tabBarIcon: tabIcon(icons.inbox),
          tabBarBadge: inboxCount > 0 ? (inboxCount > 99 ? "99+" : inboxCount) : undefined,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: "Account", tabBarIcon: tabIcon(icons.account) }}
      />
    </Tabs>
  );
}
