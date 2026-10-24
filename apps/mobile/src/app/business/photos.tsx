import { MAX_BUSINESS_PHOTOS, PHOTO_ALT_MAX_LENGTH } from "@nevile/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import type { IconName } from "@/components/icon.tsx";
import { ProAvatar } from "@/components/pro-avatar.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert, TextField } from "@/lib/auth-ui.tsx";
import type { Membership } from "@/lib/business.ts";
import { type Listing, useListingChanged } from "@/lib/listing.ts";
import { mediaUrl } from "@/lib/media.ts";
import { PhotoError, pickPhotos, uploadBusinessImage } from "@/lib/photos.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors, radius } from "@/theme";

const moveIcons = {
  up: { ios: "arrow.up", android: "arrow_upward" },
  down: { ios: "arrow.down", android: "arrow_downward" },
  add: { ios: "photo.badge.plus", android: "add_photo_alternate" },
} as const satisfies Record<string, IconName>;

function choose(title: string): Promise<"camera" | "library" | null> {
  return new Promise((resolve) =>
    Alert.alert(title, undefined, [
      { text: "Take a photo", onPress: () => resolve("camera") },
      { text: "Choose from library", onPress: () => resolve("library") },
      { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
    ]),
  );
}

function PhotosEditor({ businessId, listing }: { businessId: string; listing: Listing }) {
  const trpc = useTRPC();
  const changed = useListingChanged(businessId);
  const { business, photos, canEdit } = listing;
  const [progress, setProgress] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const onError = (error: unknown) => setProblem(apiErrorMessage(error));
  const refresh = () => changed();
  const removeLogo = useMutation(
    trpc.listing.removeLogo.mutationOptions({ onSuccess: refresh, onError }),
  );
  const remove = useMutation(
    trpc.listing.deletePhoto.mutationOptions({ onSuccess: refresh, onError }),
  );
  const reorder = useMutation(
    trpc.listing.reorderPhotos.mutationOptions({ onSuccess: refresh, onError }),
  );
  const updateAlt = useMutation(
    trpc.listing.updatePhoto.mutationOptions({ onSuccess: refresh, onError }),
  );
  const remaining = MAX_BUSINESS_PHOTOS - photos.length;
  const busy = progress !== null || reorder.isPending || remove.isPending;

  async function upload(kind: "photo" | "logo") {
    setProblem(null);
    const source = await choose(kind === "logo" ? "Your logo" : "Add work photos");
    if (!source) return;
    let assets: Awaited<ReturnType<typeof pickPhotos>>;
    try {
      assets = await pickPhotos(source, kind === "logo" ? 1 : remaining);
    } catch (error) {
      setProblem(error instanceof PhotoError ? error.message : "Couldn't open your photos.");
      return;
    }
    try {
      for (const [index, asset] of assets.entries()) {
        setProgress(
          kind === "logo" ? "Uploading your logo…" : `Uploading ${index + 1} of ${assets.length}…`,
        );
        await uploadBusinessImage(asset, businessId, kind);
      }
    } catch (error) {
      setProblem(error instanceof PhotoError ? error.message : "That upload didn't work.");
    } finally {
      setProgress(null);
      await refresh();
    }
  }

  function move(index: number, by: number) {
    const ids = photos.map((photo) => photo.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(index + by, 0, moved);
    reorder.mutate({ businessId, photoIds: ids });
  }

  const confirmRemove = (photoId: string, index: number) =>
    Alert.alert(`Delete photo ${index + 1}?`, "It's removed from your page right away.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => remove.mutate({ businessId, photoId }),
      },
    ]);

  return (
    <>
      <Text variant="display">Photos and logo</Text>
      {canEdit ? null : (
        <FormAlert tone="info" message="Only the owner and managers can change photos." />
      )}
      {progress ? <FormAlert tone="info" message={progress} /> : null}
      {problem ? <FormAlert tone="error" message={problem} /> : null}

      <Card style={styles.section}>
        <Text variant="heading">Logo</Text>
        <View style={styles.row}>
          <ProAvatar name={business.name} logoUrl={business.logoUrl} size={72} />
          {canEdit ? (
            <View style={styles.grow}>
              <Button
                label={business.logoUrl ? "Change logo" : "Upload logo"}
                variant="secondary"
                size="sm"
                disabled={busy}
                onPress={() => void upload("logo")}
              />
              {business.logoUrl ? (
                <Button
                  label="Remove logo"
                  variant="ghost"
                  size="sm"
                  disabled={busy || removeLogo.isPending}
                  onPress={() => removeLogo.mutate({ businessId })}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </Card>

      <View style={styles.section}>
        <Text variant="title">
          Work photos ({photos.length} of {MAX_BUSINESS_PHOTOS})
        </Text>
        <Text variant="small" tone="muted">
          The first photo leads your page. Location data is removed from every photo.
        </Text>
        {photos.map((photo, index) => {
          const alt = altDrafts[photo.id] ?? photo.altText;
          return (
            <Card key={photo.id} style={styles.section}>
              <Image
                source={{ uri: mediaUrl(photo.url) }}
                contentFit="cover"
                style={styles.photo}
                accessible
                accessibilityLabel={photo.altText || `Photo ${index + 1}`}
              />
              <TextField
                label={`Describe photo ${index + 1}`}
                hint="For people using screen readers, e.g. “Freshly mowed front lawn”."
                value={alt}
                maxLength={PHOTO_ALT_MAX_LENGTH}
                editable={canEdit}
                onChangeText={(value) =>
                  setAltDrafts((current) => ({ ...current, [photo.id]: value }))
                }
                onBlur={() => {
                  if (canEdit && alt.trim() !== photo.altText) {
                    updateAlt.mutate({ businessId, photoId: photo.id, altText: alt });
                  }
                }}
              />
              {canEdit ? (
                <View style={styles.actions}>
                  <Button
                    label="Up"
                    icon={moveIcons.up}
                    variant="secondary"
                    size="sm"
                    accessibilityLabel={`Move photo ${index + 1} up`}
                    disabled={busy || index === 0}
                    onPress={() => move(index, -1)}
                  />
                  <Button
                    label="Down"
                    icon={moveIcons.down}
                    variant="secondary"
                    size="sm"
                    accessibilityLabel={`Move photo ${index + 1} down`}
                    disabled={busy || index === photos.length - 1}
                    onPress={() => move(index, 1)}
                  />
                  <Button
                    label="Delete"
                    variant="ghost"
                    size="sm"
                    accessibilityLabel={`Delete photo ${index + 1}`}
                    disabled={busy}
                    onPress={() => confirmRemove(photo.id, index)}
                  />
                </View>
              ) : null}
            </Card>
          );
        })}
        {canEdit ? (
          remaining > 0 ? (
            <Button
              label="Add photos"
              icon={moveIcons.add}
              variant="secondary"
              disabled={busy}
              onPress={() => void upload("photo")}
            />
          ) : (
            <Text tone="muted">That's the maximum. Delete one to add another.</Text>
          )
        ) : null}
      </View>
    </>
  );
}

function Photos({ membership }: { membership: Membership }) {
  const trpc = useTRPC();
  const businessId = membership.business.id;
  const listing = useQuery(trpc.listing.get.queryOptions({ businessId }));
  if (listing.isPending)
    return <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />;
  if (listing.isError) return <FormAlert tone="error" message={apiErrorMessage(listing.error)} />;
  return <PhotosEditor businessId={businessId} listing={listing.data} />;
}

/** Logo and work photos for the public page (SPEC §18). */
export default function BusinessPhotosRoute() {
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  return (
    <BusinessScreen businessId={businessId} avoidKeyboard>
      {(membership) => <Photos key={membership.business.id} membership={membership} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 16 },
  grow: { flex: 1, gap: 6, alignItems: "flex-start" },
  photo: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radius.input,
    backgroundColor: colors.border,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
