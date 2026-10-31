import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, StyleSheet, View } from "react-native";

import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { type IconName, icons } from "@/components/icon.tsx";
import { PhotoPicker, photoState } from "@/components/private-photos.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton } from "@/components/top-bar.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { canManage, type Membership } from "@/lib/business.ts";
import type { PickedPhoto } from "@/lib/photos.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors, space } from "@/theme";

type Stop = inferRouterOutputs<AppRouter>["businessBookings"]["snowRoute"]["stops"][number];

const upIcon = { ios: "arrow.up", android: "arrow_upward" } as const satisfies IconName;
const downIcon = { ios: "arrow.down", android: "arrow_downward" } as const satisfies IconName;

/** One address on the route: details, reorder arrows, and Cleared with optional photos. */
function StopCard({
  stop,
  businessId,
  canReorder,
  first,
  last,
  onMove,
}: {
  stop: Stop;
  businessId: string;
  canReorder: boolean;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const uploads = photoState(photos);
  const cleared = useMutation(
    trpc.businessBookings.markCleared.mutationOptions({
      onSuccess: async () => {
        setPhotos([]);
        AccessibilityInfo.announceForAccessibility(
          `${stop.address[0] ?? "Stop"} logged as cleared.`,
        );
        await queryClient.invalidateQueries({
          queryKey: trpc.businessBookings.snowRoute.queryKey({ businessId }),
        });
      },
    }),
  );

  return (
    <Card style={styles.section}>
      <View style={styles.top}>
        <View style={styles.number} accessibilityElementsHidden>
          <Text variant="heading" tone="primary">
            {stop.stop}
          </Text>
        </View>
        <View style={styles.grow}>
          <Text
            variant="bodyStrong"
            accessibilityLabel={`Stop ${stop.stop}: ${stop.address.join(", ")}`}
          >
            {stop.address.join("\n")}
          </Text>
          <Text variant="small" tone="muted">
            {stop.customer.firstName} · {stop.title} · from {stop.triggerCm} cm
          </Text>
          <Text variant="small" tone="muted">
            {stop.visits === 0
              ? "No visits yet this season"
              : `${stop.visits} ${stop.visits === 1 ? "visit" : "visits"} · last cleared ${stop.lastClearedLabel}`}
          </Text>
          {stop.notes ? <Text variant="small">“{stop.notes}”</Text> : null}
        </View>
        {canReorder ? (
          <View>
            <IconButton
              icon={upIcon}
              label={`Move stop ${stop.stop} up`}
              disabled={first}
              onPress={() => onMove(-1)}
            />
            <IconButton
              icon={downIcon}
              label={`Move stop ${stop.stop} down`}
              disabled={last}
              onPress={() => onMove(1)}
            />
          </View>
        ) : null}
      </View>
      {stop.paused ? (
        <FormAlert
          tone="error"
          message="Paused: the customer's card didn't go through. Don't clear it until they update it."
        />
      ) : !stop.inSeason ? (
        <Text variant="small" tone="muted">
          Outside the contract&apos;s season ({stop.season}).
        </Text>
      ) : stop.justCleared && !cleared.isSuccess ? (
        <Text variant="small" tone="muted">
          Cleared a moment ago. You can log it again after 30 minutes.
        </Text>
      ) : null}
      {cleared.error ? <FormAlert tone="error" message={apiErrorMessage(cleared.error)} /> : null}
      {cleared.isSuccess ? (
        <FormAlert tone="success" message="Logged. The customer has 48 hours to confirm." />
      ) : null}
      {stop.canMark ? (
        <>
          <PhotoPicker
            purpose="visits"
            photos={photos}
            setPhotos={setPhotos}
            max={3}
            label="Add a photo"
          />
          <Button
            label="Cleared"
            icon={icons.check}
            fullWidth
            loading={cleared.isPending}
            disabled={uploads.uploading}
            onPress={() =>
              cleared.mutate({ businessId, bookingId: stop.bookingId, photoIds: uploads.ids })
            }
          />
        </>
      ) : null}
      <Button
        label="Contract details"
        variant="ghost"
        size="sm"
        onPress={() =>
          router.push({
            pathname: "/business/series/[id]",
            params: { id: stop.bookingId, businessId },
          })
        }
      />
    </Card>
  );
}

function SnowRoute({ membership }: { membership: Membership }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const businessId = membership.business.id;
  const manager = canManage(membership.role);
  const route = useQuery(trpc.businessBookings.snowRoute.queryOptions({ businessId }));
  const reorder = useMutation(
    trpc.businessBookings.reorderRoute.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.businessBookings.snowRoute.queryKey({ businessId }),
        }),
    }),
  );
  const refetch = route.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  const stops = route.data?.stops ?? [];

  function move(index: number, by: -1 | 1) {
    const order = stops.map((stop) => stop.bookingId);
    const target = index + by;
    const [moved] = order.splice(index, 1);
    if (!moved || target < 0 || target > order.length) return;
    order.splice(target, 0, moved);
    reorder.mutate({ businessId, bookingIds: order });
    AccessibilityInfo.announceForAccessibility(`Moved to stop ${target + 1}.`);
  }

  return (
    <>
      <View style={styles.section}>
        <Text variant="display">Snow route</Text>
        <Text tone="muted">
          Your active snow contracts in the order you clear them. After each storm, mark every
          address Cleared (a photo helps); the customer confirms it or reports a problem within 48
          hours.
        </Text>
      </View>
      {reorder.error ? <FormAlert tone="error" message={apiErrorMessage(reorder.error)} /> : null}
      {route.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
      ) : route.isError ? (
        <FormAlert tone="error" message={apiErrorMessage(route.error)} />
      ) : stops.length === 0 ? (
        <EmptyState
          icon={icons.bookings}
          title="No active contracts yet"
          message="List a Snow & Ice Removal service as a seasonal contract, or send contract terms in a quote. Accepted contracts show up here."
        />
      ) : (
        stops.map((stop, index) => (
          <StopCard
            key={stop.bookingId}
            stop={stop}
            businessId={businessId}
            canReorder={manager && !reorder.isPending}
            first={index === 0}
            last={index === stops.length - 1}
            onMove={(by) => move(index, by)}
          />
        ))
      )}
    </>
  );
}

/** The snow route (SPEC §21): active contracts in order, each marked Cleared after a storm. */
export default function SnowRouteRoute() {
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  return (
    <BusinessScreen businessId={businessId}>
      {(membership) => <SnowRoute key={membership.business.id} membership={membership} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  top: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  number: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tabPill,
  },
});
