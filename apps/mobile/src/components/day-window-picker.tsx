import { ScrollView, StyleSheet, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { PressableScale } from "@/components/pressable-scale.tsx";
import { Text } from "@/components/text.tsx";
import { colors, radius, space } from "@/theme";

export type PickerDay = {
  date: string;
  windows: readonly { startMinute: number; label: string; available: boolean }[];
};

// Calendar dates are already local days, so format them in UTC.
export const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
const dayName = new Intl.DateTimeFormat("en-CA", { weekday: "short", timeZone: "UTC" });
const dayNumber = new Intl.DateTimeFormat("en-CA", { day: "numeric", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" });
export const longDay = new Intl.DateTimeFormat("en-CA", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * A week of days to scroll through, then the arrival windows of the chosen day. Full days
 * and windows are shown but can't be picked.
 */
export function DayWindowPicker({
  title,
  hint,
  days,
  date,
  windowStart,
  onDate,
  onWindow,
  canGoBack,
  canGoForward,
  onPage,
}: {
  title: string;
  hint: string;
  days: readonly PickerDay[];
  date: string | null;
  windowStart: number | null;
  onDate: (date: string) => void;
  onWindow: (startMinute: number) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onPage: (by: number) => void;
}) {
  const day = days.find((candidate) => candidate.date === date) ?? null;
  const nothingOpen = !days.some((candidate) => candidate.windows.some((w) => w.available));
  return (
    <Card style={styles.section}>
      <View style={styles.row}>
        <Text variant="heading" style={styles.grow}>
          {title}
        </Text>
        <Button
          label="Earlier"
          variant="ghost"
          size="sm"
          disabled={!canGoBack}
          onPress={() => onPage(-1)}
        />
        <Button
          label="Later"
          variant="ghost"
          size="sm"
          disabled={!canGoForward}
          onPress={() => onPage(1)}
        />
      </View>
      <Text variant="small" tone="muted">
        {hint}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.dayScroll}
        contentContainerStyle={styles.days}
      >
        {days.map((candidate) => {
          const open = candidate.windows.some((window) => window.available);
          const selected = candidate.date === date;
          const when = asDate(candidate.date);
          return (
            <PressableScale
              key={candidate.date}
              accessibilityRole="button"
              accessibilityLabel={`${longDay.format(when)}${open ? "" : ", full"}`}
              accessibilityState={{ selected, disabled: !open }}
              disabled={!open}
              onPress={() => onDate(candidate.date)}
              style={[styles.day, selected && styles.selected, !open && styles.unavailable]}
            >
              <Text variant="small" tone={selected ? "primary" : "muted"}>
                {dayName.format(when)}
              </Text>
              <Text variant="title" tone={selected ? "primary" : "ink"}>
                {dayNumber.format(when)}
              </Text>
              <Text variant="small" tone={selected ? "primary" : "muted"}>
                {monthName.format(when)}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
      {day ? (
        <View style={styles.windows} accessibilityRole="radiogroup">
          <Text variant="bodyStrong">{longDay.format(asDate(day.date))}</Text>
          {day.windows.map((window) => {
            const checked = window.startMinute === windowStart;
            return (
              <PressableScale
                key={window.startMinute}
                accessibilityRole="radio"
                accessibilityLabel={`${window.label}${window.available ? "" : ", full"}`}
                accessibilityState={{ checked, disabled: !window.available }}
                disabled={!window.available}
                onPress={() => onWindow(window.startMinute)}
                style={[
                  styles.window,
                  checked && styles.selected,
                  !window.available && styles.unavailable,
                ]}
              >
                <View style={[styles.radio, checked && styles.radioOn]} />
                <Text variant="bodyStrong" style={styles.grow}>
                  {window.label}
                </Text>
                {window.available ? null : (
                  <Text variant="small" tone="muted">
                    Full
                  </Text>
                )}
              </PressableScale>
            );
          })}
        </View>
      ) : nothingOpen ? (
        <Text tone="muted">Nothing open these days. Try later dates.</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  grow: { flex: 1, minWidth: 0 },
  dayScroll: { marginHorizontal: -space.md, flexGrow: 0 },
  days: { gap: 8, paddingHorizontal: space.md },
  day: {
    width: 64,
    minHeight: 76,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { borderColor: colors.primary, backgroundColor: colors.tabPill },
  unavailable: { opacity: 0.45 },
  windows: { gap: 8, marginTop: 4 },
  window: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  radioOn: { borderColor: colors.primary, borderWidth: 6 },
});
