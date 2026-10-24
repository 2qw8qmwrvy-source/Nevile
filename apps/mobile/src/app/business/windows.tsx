import {
  ARRIVAL_WINDOW_LIMITS,
  DEFAULT_ARRIVAL_WINDOWS,
  formatArrivalWindow,
  formatMinuteOfDay,
} from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Stepper } from "@/components/stepper.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { canManage, type Membership } from "@/lib/business.ts";
import { TIME_STEP, WINDOW_RANGE } from "@/lib/team.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors } from "@/theme";

type Window = { startMinute: number; endMinute: number };
type Draft = { windows: Window[]; minNoticeDays: number; maxDaysAhead: number };

const noticeLabel = (days: number) =>
  days === 0 ? "Same day (2 hours' notice)" : days === 1 ? "Next day" : `${days} days ahead`;

function Windows({ membership }: { membership: Membership }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const businessId = membership.business.id;
  const canEdit = canManage(membership.role);
  const settings = useQuery(trpc.team.settings.queryOptions({ businessId }));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation(
    trpc.team.updateSettings.mutationOptions({
      onSuccess: async () => {
        setSaved(true);
        setDraft(null);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.team.settings.queryKey({ businessId }) }),
          queryClient.invalidateQueries({ queryKey: trpc.businessBookings.calendar.queryKey() }),
        ]);
      },
    }),
  );

  if (settings.isPending)
    return <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />;
  if (settings.isError) return <FormAlert tone="error" message={apiErrorMessage(settings.error)} />;
  const { limits } = settings.data;
  const current: Draft = draft ?? {
    windows: settings.data.windows.map(({ startMinute, endMinute }) => ({
      startMinute,
      endMinute,
    })),
    minNoticeDays: settings.data.minNoticeDays,
    maxDaysAhead: settings.data.maxDaysAhead,
  };
  const change = (next: Partial<Draft>) => {
    setSaved(false);
    setDraft({ ...current, ...next });
  };
  const setWindow = (index: number, window: Window) =>
    change({ windows: current.windows.map((existing, at) => (at === index ? window : existing)) });
  const addWindow = () => {
    const last = current.windows.at(-1);
    const startMinute = Math.min(last?.endMinute ?? 480, WINDOW_RANGE.max - 60);
    change({
      windows: [
        ...current.windows,
        { startMinute, endMinute: Math.min(startMinute + 180, WINDOW_RANGE.max) },
      ],
    });
  };

  return (
    <>
      <Text variant="display">Booking windows</Text>
      <Text tone="muted">
        Customers pick an arrival window, not an exact time. A job longer than its window carries on
        into the next one.
      </Text>
      {canEdit ? null : (
        <Text>{settings.data.windows.map((window) => window.label).join(", ")}</Text>
      )}
      {canEdit ? (
        <>
          {current.windows.map((window, index) => (
            <Card
              // biome-ignore lint/suspicious/noArrayIndexKey: windows are edited in place by position.
              key={index}
              style={styles.section}
            >
              <View style={styles.row}>
                <Text variant="heading" style={styles.grow}>
                  Window {index + 1}: {formatArrivalWindow(window)}
                </Text>
                <Button
                  label="Remove"
                  variant="ghost"
                  size="sm"
                  accessibilityLabel={`Remove window ${index + 1}`}
                  disabled={current.windows.length === 1}
                  onPress={() =>
                    change({ windows: current.windows.filter((_, at) => at !== index) })
                  }
                />
              </View>
              <Stepper
                label={`Window ${index + 1} starts`}
                value={formatMinuteOfDay(window.startMinute)}
                canLess={window.startMinute - TIME_STEP >= WINDOW_RANGE.min}
                canMore={window.startMinute + TIME_STEP < window.endMinute}
                onLess={() =>
                  setWindow(index, { ...window, startMinute: window.startMinute - TIME_STEP })
                }
                onMore={() =>
                  setWindow(index, { ...window, startMinute: window.startMinute + TIME_STEP })
                }
              />
              <Stepper
                label={`Window ${index + 1} ends`}
                value={formatMinuteOfDay(window.endMinute)}
                canLess={window.endMinute - TIME_STEP > window.startMinute}
                canMore={window.endMinute + TIME_STEP <= WINDOW_RANGE.max}
                onLess={() =>
                  setWindow(index, { ...window, endMinute: window.endMinute - TIME_STEP })
                }
                onMore={() =>
                  setWindow(index, { ...window, endMinute: window.endMinute + TIME_STEP })
                }
              />
            </Card>
          ))}
          <View style={styles.actions}>
            {current.windows.length < ARRIVAL_WINDOW_LIMITS.maxWindows ? (
              <Button label="Add a window" variant="secondary" size="sm" onPress={addWindow} />
            ) : null}
            <Button
              label="Use the usual windows"
              variant="ghost"
              size="sm"
              accessibilityHint={DEFAULT_ARRIVAL_WINDOWS.map(formatArrivalWindow).join(", ")}
              onPress={() => change({ windows: DEFAULT_ARRIVAL_WINDOWS.map((w) => ({ ...w })) })}
            />
          </View>
          <Card style={styles.section}>
            <Text variant="heading">How far ahead</Text>
            <Stepper
              label="Earliest booking"
              value={noticeLabel(current.minNoticeDays)}
              canLess={current.minNoticeDays > limits.minNoticeDays.min}
              canMore={current.minNoticeDays < limits.minNoticeDays.max}
              onLess={() => change({ minNoticeDays: current.minNoticeDays - 1 })}
              onMore={() => change({ minNoticeDays: current.minNoticeDays + 1 })}
            />
            <Stepper
              label="Latest booking"
              value={`${current.maxDaysAhead} days ahead`}
              canLess={current.maxDaysAhead - 7 >= limits.maxDaysAhead.min}
              canMore={current.maxDaysAhead + 7 <= limits.maxDaysAhead.max}
              onLess={() => change({ maxDaysAhead: current.maxDaysAhead - 7 })}
              onMore={() => change({ maxDaysAhead: current.maxDaysAhead + 7 })}
            />
          </Card>
          {save.error ? <FormAlert tone="error" message={apiErrorMessage(save.error)} /> : null}
          {saved && !save.isPending ? (
            <FormAlert tone="success" message="Saved. New bookings use these windows." />
          ) : null}
          <Button
            label="Save booking windows"
            fullWidth
            loading={save.isPending}
            disabled={!draft}
            onPress={() => save.mutate({ businessId, ...current })}
          />
        </>
      ) : null}
    </>
  );
}

/** Arrival windows and how soon / how far ahead customers can book (SPEC §19). */
export default function BusinessWindowsRoute() {
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  return (
    <BusinessScreen businessId={businessId}>
      {(membership) => <Windows key={membership.business.id} membership={membership} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
