import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, fontFamily, radius } from "@/theme";

import { Text } from "./text.tsx";

/** The Seasons bottom tab bar: white bar, hairline top border, tinted pill on the active tab. */
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const count = state.routes.length;
  return (
    <View
      accessibilityRole="tabbar"
      style={[
        styles.bar,
        {
          paddingBottom: Math.max(insets.bottom, 10),
          paddingLeft: insets.left + 8,
          paddingRight: insets.right + 8,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const descriptor = descriptors[route.key];
        if (!descriptor) return null;
        const { options } = descriptor;
        const focused = index === state.index;
        const label =
          typeof options.tabBarLabel === "string"
            ? options.tabBarLabel
            : (options.title ?? route.name);
        const tint = focused ? colors.primary : colors.muted;

        const onPress = () => {
          const event = emitter.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };
        const onLongPress = () => {
          emitter.emit({ type: "tabLongPress", target: route.key });
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={
              options.tabBarAccessibilityLabel ?? `${label}, tab, ${index + 1} of ${count}`
            }
            testID={options.tabBarButtonTestID}
            onPress={onPress}
            onLongPress={onLongPress}
            style={styles.item}
          >
            <View style={[styles.pill, focused && styles.pillActive]}>
              {options.tabBarIcon?.({ focused, color: tint, size: 22 })}
            </View>
            <Text
              variant="caption"
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              style={{
                color: tint,
                fontFamily: focused ? fontFamily.bodySemiBold : fontFamily.bodyMedium,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 6,
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  pill: {
    width: 52,
    height: 30,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  pillActive: { backgroundColor: colors.tabPill },
});
