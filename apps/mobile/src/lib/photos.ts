/**
 * Private photos for quote requests and chat (SPEC §20): taken with the camera or picked
 * from the library, uploaded to the API (which strips location data and re-encodes them),
 * and shown only with the signed-in person's session cookie.
 */
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { API_URL, getAuthCookie, useSession } from "./auth.ts";

export type PhotoPurpose = "quotes" | "chat";

/** A photo in a form: uploading, uploaded (with its id) or failed. */
export type PickedPhoto = {
  key: string;
  uri: string;
  status: "uploading" | "done" | "failed";
  id?: string;
  error?: string;
};

export class PhotoError extends Error {}

const PICKER_OPTIONS = {
  mediaTypes: ["images"],
  quality: 0.8,
  exif: false,
} satisfies ImagePicker.ImagePickerOptions;

/** Opens the camera or the system photo picker; returns up to `limit` photos. */
export async function pickPhotos(
  source: "camera" | "library",
  limit: number,
): Promise<ImagePicker.ImagePickerAsset[]> {
  if (limit <= 0) return [];
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new PhotoError("Allow camera access for Nevile in Settings to take a photo.");
    }
    const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
    return result.canceled ? [] : result.assets.slice(0, 1);
  }
  // The system photo picker needs no library permission.
  const result = await ImagePicker.launchImageLibraryAsync({
    ...PICKER_OPTIONS,
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    // HEIC photos arrive as JPEG, which the server can read.
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  return result.canceled ? [] : result.assets.slice(0, limit);
}

/** Uploads one photo; returns its id for the request or message to attach. */
export async function uploadPrivatePhoto(
  asset: Pick<ImagePicker.ImagePickerAsset, "uri" | "fileName" | "mimeType">,
  purpose: PhotoPurpose,
): Promise<string> {
  const form = new FormData();
  form.append("purpose", purpose);
  const name = asset.fileName ?? "photo.jpg";
  if (Platform.OS === "web") {
    form.append("file", await (await fetch(asset.uri)).blob(), name);
  } else {
    // React Native's FormData streams the file from its uri.
    form.append("file", {
      uri: asset.uri,
      name,
      type: asset.mimeType ?? "image/jpeg",
    } as unknown as Blob);
  }
  const cookie = await getAuthCookie();
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/private-uploads`, {
      method: "POST",
      headers: cookie ? { cookie } : {},
      body: form,
      credentials: Platform.OS === "web" ? "include" : "omit",
    });
  } catch {
    throw new PhotoError("We couldn't reach Nevile. Check your connection and try again.");
  }
  const json = (await response.json().catch(() => null)) as {
    id?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok || !json?.id) {
    throw new PhotoError(json?.error?.message ?? "We couldn't upload that photo.");
  }
  return json.id;
}

/** The session cookie for loading private photos, refreshed when the session changes. */
export function useAuthCookie(): string | null {
  const session = useSession();
  const sessionId = session.data?.session.id ?? null;
  const [cookie, setCookie] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!sessionId) {
      setCookie(null);
      return;
    }
    void getAuthCookie().then((value) => {
      if (alive) setCookie(value);
    });
    return () => {
      alive = false;
    };
  }, [sessionId]);
  return cookie;
}

export function privatePhotoUrl(id: string): string {
  return `${API_URL}/api/private-media/${encodeURIComponent(id)}`;
}
