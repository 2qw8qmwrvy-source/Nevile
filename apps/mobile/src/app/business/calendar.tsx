import { addCalendarDays, formatIsoDate, parseIsoDate, toLocal } from "@nevile/core";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { hours, JobRow } from "@/components/business-job.tsx";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { PressableScale } from "@/components/pressable-scale.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { canManage, type Membership } from "@/lib/business.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors, radius, space } from "@/theme";

// Calendar dates are already local days, so format them in UTC.
const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
const dayName = new Intl.DateTimeFormat("en-CA", { weekday: "short", timeZone: "UTC" });
const dayNumber = new Intl.DateTimeFormat("en-CA", { day: "numeric", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("en-CA", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function todayInHalifax(): string {
  const local = toLocal(new Date(), "America/Halifax");
  return formatIsoDate({ year: local.year, month: local.month, day: local.day });
}

function Calendar({ membership }: { membership: Membership }) {
  const trpc = useTRPC();
  const businessId = membership.business.id;
  const manager = canManage(membership.role);
  const [from, setFrom] = useState(todayInHalifax);
  const [selected, setSelected] = useState(todayInHalifax);
  const calendar = useQuery(
    trpc.businessBookings.calendar.queryOptions({ businessId, from, days: 7 }),
  );
  const inbox = useQuery({
    ...trpc.businessBookings.inbox.queryOptions({ businessId }),
    enabled: manager,
  });
  const refetchCalendar = calendar.refetch;
  const refetchInbox = inbox.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchCalendar();
      if (manager) void refetchInbox();
    }, [refetchCalendar, refetchInbox, manager]),
  );

  const shift = (days: number) => {
    const date = parseIsoDate(from);
    if (!date) return;
    const next = formatIsoDate(addCalendarDays(date, days));
    setFrom(next);
    setSelected(next);
  };
  const needsYou = inbox.data
    ? [...inbox.data.requests, ...inbox.data.problems, ...inbox.data.unassigned]
    : [];
  const day = calendar.data?.days.find((candidate) => candidate.date === selected);

  return (
    <>
      <Text variant="display">{manager ? "Calendar" : "Your jobs"}</Text>

      {manager && needsYou.length > 0 ? (
        <Card style={styles.section}>
          <Text variant="heading">Needs you</Text>
          <Text variant="small" tone="muted">
            Requests to answer, problems to fix and jobs nobody is assigned to yet.
          </Text>
          {needsYou.map((job) => (
            <JobRow key={`${job.id}-${job.status}`} job={job} businessId={businessId} showWindow />
          ))}
        </Card>
      ) : null}

      <View style={styles.section}>
        <View style={styles.row}>
          <Button label="Previous" variant="secondary" size="sm" onPress={() => shift(-7)} />
          <Button
            label="Today"
            variant="secondary"
            size="sm"
            onPress={() => {
              setFrom(todayInHalifax());
              setSelected(todayInHalifax());
            }}
          />
          <Button label="Next" variant="secondary" size="sm" onPress={() => shift(7)} />
        </View>
        {calendar.isPending ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
        ) : calendar.isError ? (
          <FormAlert tone="error" message={apiErrorMessage(calendar.error)} />
        ) : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.dayScroll}
              contentContainerStyle={styles.days}
            >
              {calendar.data.days.map((candidate) => {
                const count = candidate.windows.reduce((sum, w) => sum + w.jobs.length, 0);
                const active = candidate.date === selected;
                const when = asDate(candidate.date);
                return (
                  <PressableScale
                    key={candidate.date}
                    accessibilityRole="button"
                    accessibilityLabel={`${longDay.format(when)}, ${count === 0 ? "no jobs" : `${count} ${count === 1 ? "job" : "jobs"}`}`}
                    accessibilityState={{ selected: active }}
                    onPress={() => setSelected(candidate.date)}
                    style={[styles.day, active && styles.dayActive]}
                  >
                    <Text variant="small" tone={active ? "primary" : "muted"}>
                      {dayName.format(when)}
                    </Text>
                    <Text variant="title" tone={active ? "primary" : "ink"}>
                      {dayNumber.format(when)}
                    </Text>
                    <View style={[styles.dot, count === 0 && styles.dotEmpty]} />
                  </PressableScale>
                );
              })}
            </ScrollView>

            {day ? (
              <View style={styles.section}>
                <Text variant="title">{longDay.format(asDate(day.date))}</Text>
                {day.windows.length === 0 ? (
                  <Text tone="muted">No arrival windows this day.</Text>
                ) : (
                  day.windows.map((window) => {
                    const used = window.capacityMinutes - window.freeMinutes;
                    const share = window.capacityMinutes > 0 ? used / window.capacityMinutes : 1;
                    return (
                      <Card key={window.startMinute} style={styles.section}>
                        <View style={styles.windowTop}>
                          <Text variant="bodyStrong">{window.label}</Text>
                          <Text variant="small" tone="muted">
                            {window.capacityMinutes === 0
                              ? "Nobody working"
                              : `${hours(used)} of ${hours(window.capacityMinutes)} booked`}
                          </Text>
                        </View>
                        <View style={styles.bar} accessibilityElementsHidden>
                          <View
                            style={[
                              styles.barFill,
                              { width: `${Math.min(100, Math.round(share * 100))}%` },
                            ]}
                          />
                        </View>
                        {window.jobs.map((job) => (
                          <JobRow key={job.id} job={job} businessId={businessId} />
                        ))}
                      </Card>
                    );
                  })
                )}
              </View>
            ) : null}

            {calendar.data.other.length > 0 ? (
              <Card style={styles.section}>
                <Text variant="heading">Outside your current windows</Text>
                <Text variant="small" tone="muted">
                  Booked before you changed your arrival windows.
                </Text>
                {calendar.data.other.map((job) => (
                  <JobRow key={job.id} job={job} businessId={businessId} showWindow />
                ))}
              </Card>
            ) : null}
          </>
        )}
      </View>
    </>
  );
}

/** Jobs by day and arrival window, and what needs an answer (SPEC §19). */
export default function BusinessCalendarRoute() {
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  return (
    <BusinessScreen businessId={businessId}>
      {(membership) => <Calendar key={membership.business.id} membership={membership} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  row: { flexDirection: "row", gap: 8 },
  dayScroll: { marginHorizontal: -20, flexGrow: 0 },
  days: { gap: 8, paddingHorizontal: 20 },
  day: {
    width: 56,
    minHeight: 76,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dayActive: { borderColor: colors.primary, backgroundColor: colors.tabPill },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  dotEmpty: { backgroundColor: "transparent" },
  windowTop: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: colors.primary },
});
