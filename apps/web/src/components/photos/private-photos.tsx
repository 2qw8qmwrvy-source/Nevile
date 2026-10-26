"use client";

import { PHOTO_MAX_BYTES } from "@nevile/core";
import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import { buttonClasses } from "@/components/ui/button.tsx";
import { cn } from "@/lib/cn.ts";

// iPhones hand HEIC photos to the browser as JPEG when HEIC isn't in this list.
const ACCEPT = "image/jpeg,image/png,image/webp";

export type UploadedPhoto = { id: string; preview: string };
/** Quote requests and chat (SPEC §20), or a snow route visit log (§21). */
export type PrivatePhotoPurpose = "quotes" | "chat" | "visits";

async function uploadPrivatePhoto(purpose: PrivatePhotoPurpose, file: File): Promise<string> {
  if (file.size > PHOTO_MAX_BYTES) throw new Error(`${file.name} is over 10 MB.`);
  const body = new FormData();
  body.set("purpose", purpose);
  body.set("file", file);
  const response = await fetch("/api/private-uploads", { method: "POST", body });
  const data = (await response.json().catch(() => null)) as {
    id?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok || !data?.id) {
    throw new Error(data?.error?.message ?? "That photo didn't upload. Please try again.");
  }
  return data.id;
}

/**
 * Adds up to `max` private photos (quote requests, chat, visit logs). Each is uploaded
 * straight away (re-encoded on the server, metadata removed); the parent keeps the ids.
 */
export function PrivatePhotoPicker({
  purpose,
  photos,
  onChange,
  max,
  label = "Add photos",
  compact = false,
}: {
  purpose: PrivatePhotoPurpose;
  photos: UploadedPhoto[];
  onChange: (photos: UploadedPhoto[]) => void;
  max: number;
  label?: string;
  compact?: boolean;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Previews are object URLs; release them when the picker goes away.
  const latest = useRef(photos);
  latest.current = photos;
  useEffect(
    () => () => {
      for (const photo of latest.current) URL.revokeObjectURL(photo.preview);
    },
    [],
  );
  const room = max - photos.length;

  async function add(files: File[]) {
    setProblem(null);
    if (files.length > room) setProblem(`You can add up to ${max} photos.`);
    setBusy(true);
    const added: UploadedPhoto[] = [];
    try {
      for (const file of files.slice(0, Math.max(0, room))) {
        added.push({
          id: await uploadPrivatePhoto(purpose, file),
          preview: URL.createObjectURL(file),
        });
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That photo didn't upload.");
    } finally {
      setBusy(false);
      if (added.length > 0) onChange([...photos, ...added]);
    }
  }

  return (
    <div className="grid gap-2">
      {photos.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Photos added">
          {photos.map((photo, index) => (
            <li key={photo.id} className="relative">
              {/* biome-ignore lint/performance/noImgElement: a local preview of the file being sent. */}
              <img
                src={photo.preview}
                alt={`Attachment ${index + 1}`}
                className={cn(
                  "rounded-input border border-border object-cover",
                  compact ? "size-14" : "size-20",
                )}
              />
              <button
                type="button"
                className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full border border-border bg-surface text-sm font-bold text-ink shadow-card"
                aria-label={`Remove photo ${index + 1}`}
                onClick={() => onChange(photos.filter((candidate) => candidate.id !== photo.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {room > 0 ? (
        <span className="relative inline-flex w-fit">
          <input
            id={id}
            type="file"
            accept={ACCEPT}
            multiple
            disabled={busy}
            className="peer absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              if (files.length > 0) void add(files);
            }}
          />
          <label
            htmlFor={id}
            className={cn(
              buttonClasses({ variant: "secondary", size: "sm" }),
              "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
              busy && "opacity-55",
            )}
          >
            {busy ? "Uploading…" : label}
          </label>
        </span>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** Private photos already sent, loaded through the access-checked route. */
export function PrivatePhotoGrid({
  photos,
  size = "md",
}: {
  photos: ReadonlyArray<{ id: string; width: number; height: number }>;
  size?: "sm" | "md";
}) {
  if (photos.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Photos">
      {photos.map((photo, index) => (
        <li key={photo.id}>
          <a
            href={`/api/private-media/${photo.id}`}
            target="_blank"
            rel="noopener"
            className="block"
          >
            {/* biome-ignore lint/performance/noImgElement: private images can't go through the public image optimizer. */}
            <img
              src={`/api/private-media/${photo.id}`}
              width={photo.width}
              height={photo.height}
              alt={`Attachment ${index + 1} of ${photos.length}`}
              loading="lazy"
              className={cn(
                "rounded-input border border-border bg-ground object-cover",
                size === "sm" ? "size-24" : "size-32",
              )}
            />
          </a>
        </li>
      ))}
    </ul>
  );
}
