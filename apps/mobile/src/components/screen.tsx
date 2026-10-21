import type { ReactNode } from "react";
import { ScrollView, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { type Edge, SafeAreaView } from "react-native-safe-area-context";

import { colors, space } from "@/theme";

import { Text } from "./text.tsx";

export type ScreenProps = {
  children: ReactNode;
  /** Large page title rendered at the top of the content. */
  title?: string;
  subtitle?: string;
  /** Wrap content in a ScrollView (default true). */
  scroll?: boolean;
  /** Safe-area edges to pad; the tab bar already handles the bottom inset. */
  edges?: readonly Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  /** Rendered above the scroll area, outside it (e.g. a sticky search field). */
  header?: ReactNode;
};

const DEFAULT_EDGES: readonly Edge[] = ["top", "left", "right"];

/** Page wrapper: Seasons ground background, safe-area padding and a consistent gutter. */
export function Screen({
  children,
  title,
  subtitle,
  scroll = true,
  edges = DEFAULT_EDGES,
  contentStyle,
  header,
}: ScreenProps) {
  const heading = title ? (
    <View style={styles.heading}>
      <Text variant="display">{title}</Text>
      {subtitle ? (
        <Text tone="muted" style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  ) : null;

  return (
    <SafeAreaView edges={edges} style={styles.root}>
      {header}
      {scroll ? (
        <ScrollView
          style={styles.root}
          contentContainerStyle={[styles.content, contentStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {heading}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.root, styles.content, contentStyle]}>
          {heading}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  content: { paddingHorizontal: 20, paddingTop: space.md, paddingBottom: space.xl, flexGrow: 1 },
  heading: { marginBottom: space.lg },
  subtitle: { marginTop: 4 },
});
