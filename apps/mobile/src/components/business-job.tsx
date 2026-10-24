import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { formatCad } from "@nevile/core";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { statusColors } from "@/lib/bookings.ts";
import { colors } from "@/theme";

import { Badge } from "./badge.tsx";
import { Icon, icons } from "./icon.tsx";
import { PressableScale } from "./pressable-scale.tsx";
import { Text } from "./text.tsx";

export type BusinessJob = inferRouterOutputs<AppRouter>["businessBookings"]["get"];

/** "1.5 h" for work minutes. */
export function hours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10} h`;
}

/** One job or request in a list; opens the job. */
export function JobRow({
  job,
  businessId,
  showWindow = false,
}: {
  job: BusinessJob;
  businessId: string;
  showWindow?: boolean;
}) {
  const tone = statusColors(job.status);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${job.service.title} for ${job.customer.firstName}, ${job.window.label}, ${job.statusLabel}`}
      pressedScale={0.98}
      onPress={() =>
        router.push({ pathname: "/business/bookings/[id]", params: { id: job.id, businessId } })
      }
      style={styles.row}
    >
      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {job.service.title}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {showWindow ? `${job.window.label} · ` : ""}
          {job.customer.firstName} · {hours(job.workMinutes)} · you get{" "}
          {formatCad(job.payout.cents)}
        </Text>
        <View style={styles.meta}>
          <Badge
            label={job.statusLabel}
            size="sm"
            background={tone.background}
            textColor={tone.text}
          />
          {job.assignee ? (
            <Text variant="small" tone="muted">
              Crew: {job.assignee.name}
            </Text>
          ) : null}
        </View>
      </View>
      <Icon name={icons.chevronRight} size={16} color={colors.muted} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  body: { flex: 1, minWidth: 0, gap: 4 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
});
