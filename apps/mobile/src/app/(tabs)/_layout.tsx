import { Tabs } from "expo-router/js-tabs";
import type { ColorValue } from "react-native";

import { Icon, type IconName, icons } from "@/components/icon.tsx";
import { TabBar } from "@/components/tab-bar.tsx";
import { colors } from "@/theme";

function tabIcon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Icon name={name} size={size} color={color} />
  );
}

export default function TabsLayout() {
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
      <Tabs.Screen name="inbox" options={{ title: "Inbox", tabBarIcon: tabIcon(icons.inbox) }} />
      <Tabs.Screen
        name="account"
        options={{ title: "Account", tabBarIcon: tabIcon(icons.account) }}
      />
    </Tabs>
  );
}
