import { Image } from "expo-image";
import { type Dispatch, type SetStateAction, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  PhotoError,
  type PhotoPurpose,
  type PickedPhoto,
  pickPhotos,
  privatePhotoUrl,
  uploadPrivatePhoto,
  useAuthCookie,
} from "@/lib/photos.ts";
import { colors, radius } from "@/theme";

import { Button } from "./button.tsx";
import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";
import { IconButton, topBarIcons } from "./top-bar.tsx";

const cameraIcon = { ios: "camera", android: "photo_camera" } as const satisfies IconName;
const removeIcon = { ios: "xmark", android: "close" } as const satisfies IconName;

/** Private photos (quote request or chat), loaded with the session; tap one to enlarge. */
export function PrivatePhotoGrid({
  photos,
  size = 96,
}: {
  photos: ReadonlyArray<{ id: string }>;
  size?: number;
}) {
  const cookie = useAuthCookie();
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0 || cookie === null) return null;
  const source = (id: string) => ({ uri: privatePhotoUrl(id), headers: { cookie } });
  const current = open === null ? undefined : photos[open];
  return (
    <>
      <View style={styles.grid}>
        {photos.map((photo, index) => (
          <Pressable
            key={photo.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Attachment ${index + 1} of ${photos.length}`}
            accessibilityHint="Shows it full screen"
            onPress={() => setOpen(index)}
          >
            <Image
              source={source(photo.id)}
              // Personal photos stay in memory only, never in the disk cache.
              cachePolicy="memory"
              contentFit="cover"
              style={[styles.thumb, { width: size, height: size }]}
            />
          </Pressable>
        ))}
      </View>
      <Modal
        visible={current !== undefined}
        animationType="fade"
        onRequestClose={() => setOpen(null)}
        supportedOrientations={["portrait"]}
      >
        <SafeAreaView style={styles.viewer}>
          <View style={styles.viewerBar}>
            <Text tone="onPrimary">{open === null ? "" : `${open + 1} of ${photos.length}`}</Text>
            <IconButton icon={topBarIcons.close} label="Close" onPress={() => setOpen(null)} />
          </View>
          {current ? (
            <Image
              source={source(current.id)}
              cachePolicy="memory"
              contentFit="contain"
              style={styles.full}
              accessibilityLabel={`Attachment ${(open ?? 0) + 1} of ${photos.length}`}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </>
  );
}

/**
 * Adds photos from the camera or library and uploads each one straight away. The form
 * sends the ids of the uploaded ones.
 */
export function PhotoPicker({
  purpose,
  photos,
  setPhotos,
  max,
  label = "Add photos",
}: {
  purpose: PhotoPurpose;
  photos: PickedPhoto[];
  setPhotos: Dispatch<SetStateAction<PickedPhoto[]>>;
  max: number;
  label?: string;
}) {
  const remaining = max - photos.length;

  async function add(source: "camera" | "library") {
    let assets: Awaited<ReturnType<typeof pickPhotos>>;
    try {
      assets = await pickPhotos(source, remaining);
    } catch (error) {
      Alert.alert(
        "Couldn't add a photo",
        error instanceof PhotoError ? error.message : "Please try again.",
      );
      return;
    }
    const added = assets.map((asset, index) => ({
      asset,
      photo: {
        key: `${Date.now()}-${index}-${asset.uri}`,
        uri: asset.uri,
        status: "uploading" as const,
      },
    }));
    setPhotos((current) => [...current, ...added.map((item) => item.photo)].slice(0, max));
    await Promise.all(
      added.map(async ({ asset, photo }) => {
        const update = (patch: Partial<PickedPhoto>) =>
          setPhotos((current) =>
            current.map((item) => (item.key === photo.key ? { ...item, ...patch } : item)),
          );
        try {
          update({ status: "done", id: await uploadPrivatePhoto(asset, purpose) });
        } catch (error) {
          update({
            status: "failed",
            error: error instanceof PhotoError ? error.message : "Upload failed.",
          });
        }
      }),
    );
  }

  function choose() {
    Alert.alert(label, undefined, [
      { text: "Take a photo", onPress: () => void add("camera") },
      { text: "Choose from library", onPress: () => void add("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const failed = photos.find((photo) => photo.status === "failed");
  return (
    <View style={styles.picker}>
      {photos.length > 0 ? (
        <View style={styles.grid} accessibilityLabel="Photos added">
          {photos.map((photo, index) => (
            <View key={photo.key} style={styles.pickedWrap}>
              <Image
                source={{ uri: photo.uri }}
                contentFit="cover"
                style={[styles.thumb, styles.picked, photo.status === "failed" && styles.failed]}
                accessibilityLabel={`Photo ${index + 1}${photo.status === "uploading" ? ", uploading" : photo.status === "failed" ? ", failed to upload" : ""}`}
              />
              {photo.status === "uploading" ? (
                <View style={styles.overlay}>
                  <ActivityIndicator color={colors.onPrimary} />
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${index + 1}`}
                hitSlop={8}
                onPress={() =>
                  setPhotos((current) => current.filter((item) => item.key !== photo.key))
                }
                style={styles.remove}
              >
                <Icon name={removeIcon} size={12} color={colors.onPrimary} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {failed ? (
        <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
          {failed.error ?? "A photo didn't upload."} Remove it and try again.
        </Text>
      ) : null}
      {remaining > 0 ? (
        <Button label={label} icon={cameraIcon} variant="secondary" size="sm" onPress={choose} />
      ) : null}
    </View>
  );
}

/** Ids of uploaded photos, and whether any are still uploading or failed. */
export function photoState(photos: readonly PickedPhoto[]) {
  return {
    ids: photos.flatMap((photo) => (photo.status === "done" && photo.id ? [photo.id] : [])),
    uploading: photos.some((photo) => photo.status === "uploading"),
    failed: photos.some((photo) => photo.status === "failed"),
  };
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumb: { borderRadius: radius.input, backgroundColor: colors.border },
  picker: { gap: 10 },
  pickedWrap: { position: "relative" },
  picked: { width: 72, height: 72 },
  failed: { opacity: 0.4 },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.input,
    backgroundColor: "rgba(24, 33, 29, 0.35)",
  },
  remove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
  },
  viewer: { flex: 1, backgroundColor: "#000" },
  viewerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  full: { flex: 1 },
});
