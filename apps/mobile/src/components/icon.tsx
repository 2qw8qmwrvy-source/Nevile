import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";

type SymbolName = ComponentProps<typeof SymbolView>["name"];
type SymbolPair = Extract<SymbolName, object>;

/** A platform icon: SF Symbol on iOS, Material Symbol on Android and web. */
export type IconName = {
  ios: NonNullable<SymbolPair["ios"]>;
  android: NonNullable<SymbolPair["android"]>;
};

export type IconProps = {
  name: IconName;
  size?: number;
  color: ColorValue;
  style?: StyleProp<ViewStyle>;
};

/** Decorative icon; give the surrounding control the accessible label. */
export function Icon({ name, size = 22, color, style }: IconProps) {
  return (
    <SymbolView
      name={{ ios: name.ios, android: name.android, web: name.android }}
      size={size}
      tintColor={color}
      weight="medium"
      style={style}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}

/** Icons used across the shell, kept in one place so platforms stay paired. */
export const icons = {
  home: { ios: "house", android: "home" },
  search: { ios: "magnifyingglass", android: "search" },
  bookings: { ios: "calendar", android: "calendar_month" },
  inbox: { ios: "bubble.left", android: "chat_bubble" },
  account: { ios: "person.crop.circle", android: "person" },
  chevronRight: { ios: "chevron.right", android: "chevron_right" },
  clear: { ios: "xmark.circle.fill", android: "close" },
  check: { ios: "checkmark.circle", android: "check_circle" },
  card: { ios: "creditcard", android: "credit_card" },
  switchMode: { ios: "arrow.left.arrow.right", android: "swap_horiz" },
  signOut: { ios: "rectangle.portrait.and.arrow.right", android: "logout" },
  person: { ios: "person", android: "person" },
  business: { ios: "storefront", android: "storefront" },
  chat: { ios: "bubble.left.and.bubble.right", android: "forum" },
  booked: { ios: "calendar.badge.checkmark", android: "event_available" },
} as const satisfies Record<string, IconName>;
