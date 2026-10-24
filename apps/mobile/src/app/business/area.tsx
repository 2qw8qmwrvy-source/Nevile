import { postalAreaOf, SERVICE_RADIUS_MAX_KM, SERVICE_RADIUS_MIN_KM } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Chip } from "@/components/chip.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert, TextField } from "@/lib/auth-ui.tsx";
import type { Membership } from "@/lib/business.ts";
import { openWebsitePage } from "@/lib/links.ts";
import { type Listing, useListingChanged } from "@/lib/listing.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors } from "@/theme";

const DEFAULT_RADIUS_KM = 25;
const RADIUS_CHOICES = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100].filter(
  (km) => km >= SERVICE_RADIUS_MIN_KM && km <= SERVICE_RADIUS_MAX_KM,
);

function AreaForm({ businessId, listing }: { businessId: string; listing: Listing }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const changed = useListingChanged(businessId);
  const current = listing.serviceArea;
  const [postal, setPostal] = useState("");
  const [center, setCenter] = useState(current ? { lat: current.lat, lng: current.lng } : null);
  const [place, setPlace] = useState<string | null>(current?.label ?? null);
  const [radiusKm, setRadiusKm] = useState(current?.radiusKm ?? DEFAULT_RADIUS_KM);
  const [problem, setProblem] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const save = useMutation(
    trpc.listing.setServiceArea.mutationOptions({
      onSuccess: async () => {
        await changed();
        if (router.canGoBack()) router.back();
      },
    }),
  );

  async function lookUp() {
    setProblem(null);
    if (!postalAreaOf(postal)) {
      setProblem("Enter a postal code like B4A 1A1.");
      return;
    }
    setLooking(true);
    try {
      const result = await queryClient.fetchQuery(
        trpc.search.area.queryOptions({ postalCode: postal }),
      );
      if (result.kind === "found") {
        setCenter(result.center);
        setPlace(result.placeName);
      } else if (result.kind === "outside") {
        setProblem("That postal code is outside Nova Scotia.");
      } else {
        setProblem("We don't know that postal code yet. Try a nearby one.");
      }
    } catch (error) {
      setProblem(apiErrorMessage(error, "We couldn't look that up. Try again."));
    } finally {
      setLooking(false);
    }
  }

  return (
    <>
      <Text variant="display">Service area</Text>
      <Text tone="muted">
        Customers whose postal code is inside your area can find and book you. Start from the postal
        code you work from, then pick how far you travel.
      </Text>
      {listing.canEdit ? null : (
        <FormAlert tone="info" message="Only the owner and managers can change the area." />
      )}
      <Card style={styles.section}>
        <Text variant="heading">Where you start from</Text>
        <Text>{place ? `Near ${place}` : "Not set yet"}</Text>
        {listing.canEdit ? (
          <View style={styles.row}>
            <View style={styles.grow}>
              <TextField
                label="Postal code"
                value={postal}
                onChangeText={setPostal}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="postal-code"
                maxLength={7}
                returnKeyType="search"
                onSubmitEditing={() => void lookUp()}
              />
            </View>
            <View style={styles.lookUp}>
              <Button
                label="Use it"
                variant="secondary"
                loading={looking}
                onPress={() => void lookUp()}
              />
            </View>
          </View>
        ) : null}
        {problem ? <FormAlert tone="error" message={problem} /> : null}
      </Card>
      <Card style={styles.section}>
        <Text variant="heading">How far you travel</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {RADIUS_CHOICES.map((km) => (
            <Chip
              key={km}
              label={`${km} km`}
              selected={radiusKm === km}
              disabled={!listing.canEdit}
              accessibilityRole="radio"
              accessibilityState={{ checked: radiusKm === km, disabled: !listing.canEdit }}
              onPress={() => setRadiusKm(km)}
            />
          ))}
        </View>
      </Card>
      <Text variant="small" tone="muted">
        To place your pin exactly on a map, use Listing on the Nevile website.
      </Text>
      <Button
        label="Open the map on the website"
        variant="ghost"
        onPress={() => void openWebsitePage(`/business?b=${businessId}#area`)}
      />
      {save.error ? <FormAlert tone="error" message={apiErrorMessage(save.error)} /> : null}
      {listing.canEdit ? (
        <Button
          label="Save service area"
          fullWidth
          loading={save.isPending}
          disabled={!center}
          onPress={() => center && save.mutate({ businessId, center, radiusKm })}
        />
      ) : null}
    </>
  );
}

function Area({ membership }: { membership: Membership }) {
  const trpc = useTRPC();
  const businessId = membership.business.id;
  const listing = useQuery(trpc.listing.get.queryOptions({ businessId }));
  if (listing.isPending)
    return <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />;
  if (listing.isError) return <FormAlert tone="error" message={apiErrorMessage(listing.error)} />;
  return <AreaForm businessId={businessId} listing={listing.data} />;
}

/** Service area by postal code and distance; the map editor stays on the website (SPEC §20). */
export default function BusinessAreaRoute() {
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  return (
    <BusinessScreen businessId={businessId} avoidKeyboard>
      {(membership) => <Area key={membership.business.id} membership={membership} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  grow: { flex: 1 },
  lookUp: { marginTop: 29 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
