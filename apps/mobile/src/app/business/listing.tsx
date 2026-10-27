import { FREQUENCY_LABELS } from "@nevile/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Badge } from "@/components/badge.tsx";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Icon, type IconName, icons } from "@/components/icon.tsx";
import { ListRow } from "@/components/list-row.tsx";
import { PressableScale } from "@/components/pressable-scale.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import type { Membership } from "@/lib/business.ts";
import { useListingChanged } from "@/lib/listing.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors, seasons } from "@/theme";

const rowIcons = {
  profile: { ios: "person.text.rectangle", android: "badge" },
  area: { ios: "mappin.and.ellipse", android: "location_on" },
  photos: { ios: "photo.on.rectangle", android: "photo_library" },
  add: { ios: "plus.circle", android: "add_circle" },
} as const satisfies Record<string, IconName>;

const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" });

type ListingRoute =
  | "/business/profile"
  | "/business/area"
  | "/business/photos"
  | "/business/service";

/** Where each checklist item is fixed. */
const FIX_ROUTES: Record<string, ListingRoute> = {
  name: "/business/profile",
  about: "/business/profile",
  service_area: "/business/area",
  services: "/business/service",
};

function ListingOverview({ membership }: { membership: Membership }) {
  const trpc = useTRPC();
  const businessId = membership.business.id;
  const listing = useQuery(trpc.listing.get.queryOptions({ businessId }));
  const changed = useListingChanged(businessId);
  const publish = useMutation(trpc.listing.publish.mutationOptions({ onSuccess: () => changed() }));
  const unpublish = useMutation(
    trpc.listing.unpublish.mutationOptions({ onSuccess: () => changed() }),
  );
  const open = (pathname: ListingRoute, extra: { serviceId?: string } = {}) =>
    router.push({ pathname, params: { businessId, ...extra } });

  if (listing.isPending) {
    return <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />;
  }
  if (listing.isError) return <FormAlert tone="error" message={apiErrorMessage(listing.error)} />;
  const { business, readiness, canEdit, services, photos, serviceArea } = listing.data;
  const published = business.publishedAt !== null;
  const busy = publish.isPending || unpublish.isPending;

  return (
    <>
      <View style={styles.section}>
        <Text variant="display">Listing</Text>
        {canEdit ? null : (
          <FormAlert tone="info" message="Only the owner and managers can change the listing." />
        )}
      </View>

      <Card style={styles.section}>
        <Text variant="heading">
          {published
            ? "Your listing is live"
            : readiness.ready
              ? "Ready to publish"
              : "Get ready to publish"}
        </Text>
        <Text tone="muted">
          {published
            ? `Customers can find you in search since ${dateFormat.format(business.publishedAt ?? new Date())}.`
            : readiness.ready
              ? "Everything's in place. Publish to appear in search for customers in your area."
              : "Finish these and you can publish. Your changes are saved as you go."}
        </Text>
        {readiness.missing.map((item) => {
          const route = FIX_ROUTES[item.key];
          return (
            <PressableScale
              key={item.key}
              accessibilityRole={route ? "button" : undefined}
              disabled={!route || !canEdit}
              onPress={() => route && open(route)}
              style={styles.missing}
            >
              <View style={styles.ring} />
              <Text style={styles.grow}>{item.label}</Text>
              {route ? <Icon name={icons.chevronRight} size={16} color={colors.muted} /> : null}
            </PressableScale>
          );
        })}
        {publish.data && !publish.data.published ? (
          <FormAlert
            tone="error"
            message={`Not yet: ${publish.data.missing.map((item) => item.label.toLowerCase()).join("; ")}.`}
          />
        ) : null}
        {publish.error || unpublish.error ? (
          <FormAlert tone="error" message={apiErrorMessage(publish.error ?? unpublish.error)} />
        ) : null}
        {canEdit ? (
          published ? (
            <Button
              label="Unpublish"
              variant="secondary"
              loading={unpublish.isPending}
              disabled={busy}
              onPress={() => unpublish.mutate({ businessId })}
            />
          ) : (
            <Button
              label="Publish listing"
              loading={publish.isPending}
              disabled={busy || !readiness.ready}
              onPress={() => publish.mutate({ businessId })}
            />
          )
        ) : null}
      </Card>

      <Card flush style={styles.card}>
        <ListRow
          label="Profile"
          description={`${business.name} · ${business.instantBook ? "Instant Book on" : "Instant Book off"}`}
          icon={rowIcons.profile}
          onPress={() => open("/business/profile")}
        />
        <ListRow
          label="Service area"
          description={serviceArea ? serviceArea.description : "Not set yet"}
          icon={rowIcons.area}
          divider
          onPress={() => open("/business/area")}
        />
        <ListRow
          label="Photos and logo"
          description={`${photos.length} ${photos.length === 1 ? "photo" : "photos"}${business.logoUrl ? " · logo added" : ""}`}
          icon={rowIcons.photos}
          divider
          onPress={() => open("/business/photos")}
        />
      </Card>

      <View style={styles.section}>
        <Text variant="title">Services</Text>
        {services.length === 0 ? (
          <Text tone="muted">Add what you offer, with a fixed price or by quote.</Text>
        ) : (
          services.map((service) => (
            <PressableScale
              key={service.id}
              accessibilityRole="button"
              accessibilityLabel={`${service.title}, ${service.priceText}${service.active ? "" : ", hidden"}`}
              disabled={!canEdit}
              pressedScale={0.98}
              onPress={() => open("/business/service", { serviceId: service.id })}
              style={styles.service}
            >
              <View style={styles.grow}>
                <Text variant="bodyStrong">{service.title}</Text>
                <Text variant="small" tone="muted">
                  {service.categoryName} · {service.priceText}
                  {service.recurrenceFrequencies.length > 0
                    ? ` · also ${service.recurrenceFrequencies
                        .map((frequency) => FREQUENCY_LABELS[frequency].toLowerCase())
                        .join(" or ")}`
                    : ""}
                </Text>
                <View style={styles.badges}>
                  {service.contract ? (
                    <Badge
                      label="Seasonal contract"
                      size="sm"
                      background={seasons.winter.tint}
                      textColor={colors.ink}
                    />
                  ) : null}
                  {service.instantBook && business.instantBook ? (
                    <Badge label="Instant Book" size="sm" />
                  ) : null}
                  {service.active ? null : (
                    <Badge
                      label="Hidden"
                      size="sm"
                      background={seasons.summer.tint}
                      textColor={colors.ink}
                    />
                  )}
                </View>
              </View>
              {canEdit ? <Icon name={icons.chevronRight} size={16} color={colors.muted} /> : null}
            </PressableScale>
          ))
        )}
        {canEdit ? (
          <Button
            label="Add a service"
            icon={rowIcons.add}
            variant="secondary"
            onPress={() => open("/business/service")}
          />
        ) : null}
      </View>
    </>
  );
}

/** The public listing: status, profile, area, photos and services (SPEC §18). */
export default function BusinessListingRoute() {
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  return (
    <BusinessScreen businessId={businessId}>
      {(membership) => <ListingOverview key={membership.business.id} membership={membership} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  card: { overflow: "hidden" },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  missing: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ground,
  },
  ring: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  service: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
});
