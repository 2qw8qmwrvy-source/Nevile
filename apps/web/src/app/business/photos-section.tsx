"use client";

import { MAX_BUSINESS_PHOTOS, PHOTO_ALT_MAX_LENGTH, PHOTO_MAX_BYTES } from "@nevile/core";
import { useMutation } from "@tanstack/react-query";
import { type ChangeEvent, useId, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { ProAvatar } from "@/components/pros/pro-avatar.tsx";
import { Button, buttonClasses } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/field.tsx";
import { cn } from "@/lib/cn.ts";
import { useTRPC } from "@/lib/trpc.ts";
import type { SectionProps } from "./listing-dashboard.tsx";
import { sectionTitleClass, useRefreshListing } from "./use-listing.ts";

// iPhones hand HEIC photos to the browser as JPEG when HEIC isn't in this list.
const ACCEPT = "image/jpeg,image/png,image/webp";

async function uploadImage(businessId: string, kind: "photo" | "logo", file: File) {
  if (file.size > PHOTO_MAX_BYTES) throw new Error(`${file.name} is over 10 MB.`);
  const body = new FormData();
  body.set("businessId", businessId);
  body.set("kind", kind);
  body.set("file", file);
  const response = await fetch("/api/uploads", { method: "POST", body });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(data?.error?.message ?? "That upload didn't work. Please try again.");
  }
}

/** File picker styled as a button (the input stays focusable for keyboards). */
function FilePicker({
  label,
  multiple,
  disabled,
  onFiles,
}: {
  label: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const id = useId();
  return (
    <span className="relative inline-flex">
      <input
        id={id}
        type="file"
        accept={ACCEPT}
        multiple={multiple}
        disabled={disabled}
        className="peer absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
      <label
        htmlFor={id}
        className={cn(
          buttonClasses({ variant: "secondary", size: "sm" }),
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
          disabled && "opacity-55",
        )}
      >
        {label}
      </label>
    </span>
  );
}

/** Logo and up to 8 work photos (SPEC §18). Uploads are re-encoded without metadata. */
export function PhotosSection({ listing, businessId }: SectionProps) {
  const trpc = useTRPC();
  const refresh = useRefreshListing(businessId);
  const { business, photos, canEdit } = listing;
  const [progress, setProgress] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const onError = (error: { message: string }) => setProblem(error.message);

  const removeLogo = useMutation(
    trpc.listing.removeLogo.mutationOptions({ onSuccess: refresh, onError }),
  );
  const deletePhoto = useMutation(
    trpc.listing.deletePhoto.mutationOptions({ onSuccess: refresh, onError }),
  );
  const reorder = useMutation(
    trpc.listing.reorderPhotos.mutationOptions({ onSuccess: refresh, onError }),
  );
  const updateAlt = useMutation(
    trpc.listing.updatePhoto.mutationOptions({ onSuccess: refresh, onError }),
  );
  const remaining = MAX_BUSINESS_PHOTOS - photos.length;
  const busy = progress !== null || reorder.isPending;

  async function upload(kind: "photo" | "logo", files: File[]) {
    setProblem(null);
    const batch = kind === "photo" ? files.slice(0, remaining) : files.slice(0, 1);
    try {
      for (const [index, file] of batch.entries()) {
        setProgress(batch.length > 1 ? `Uploading ${index + 1} of ${batch.length}…` : "Uploading…");
        await uploadImage(businessId, kind, file);
      }
      if (kind === "photo" && files.length > batch.length) {
        setProblem(
          `Only ${MAX_BUSINESS_PHOTOS} photos fit, so we added the first ${batch.length}.`,
        );
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That upload didn't work.");
    } finally {
      setProgress(null);
      await refresh();
    }
  }

  function move(index: number, by: -1 | 1) {
    const ids = photos.map((photo) => photo.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(index + by, 0, moved);
    reorder.mutate({ businessId, photoIds: ids });
  }

  return (
    <Card as="section" id="photos" aria-labelledby="photos-title" className="scroll-mt-24">
      <h2 id="photos-title" className={sectionTitleClass}>
        Logo and photos
      </h2>
      <p className="mt-1.5 text-[15px] text-muted">
        JPEG, PNG or WebP up to 10 MB. We resize every image and remove hidden details such as the
        location it was taken.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <ProAvatar name={business.name} logoUrl={business.logoUrl} size="lg" />
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <FilePicker
              label={business.logoUrl ? "Change logo" : "Upload logo"}
              disabled={busy}
              onFiles={(files) => upload("logo", files)}
            />
            {business.logoUrl ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || removeLogo.isPending}
                onClick={() => removeLogo.mutate({ businessId })}
              >
                Remove logo
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <h3 className="mt-7 text-[17px] font-semibold">
        Work photos{" "}
        <span className="font-normal text-muted">
          ({photos.length} of {MAX_BUSINESS_PHOTOS})
        </span>
      </h3>
      {photos.length === 0 ? (
        <p className="mt-1.5 text-[15px] text-muted">
          Before-and-after shots and finished jobs help customers choose you.
        </p>
      ) : (
        <ul className="mt-3 grid gap-4 sm:grid-cols-2">
          {photos.map((photo, index) => {
            const alt = altDrafts[photo.id] ?? photo.altText;
            return (
              <li
                key={photo.id}
                className="overflow-hidden rounded-card border border-border bg-ground"
              >
                {/* biome-ignore lint/performance/noImgElement: media is already resized WebP. */}
                <img
                  src={photo.url}
                  alt={photo.altText || `Photo ${index + 1}`}
                  width={photo.width}
                  height={photo.height}
                  className="aspect-[4/3] h-auto w-full bg-subtle object-cover"
                />
                <div className="grid gap-2.5 p-3">
                  <label className="text-[13px] font-semibold" htmlFor={`alt-${photo.id}`}>
                    Describe this photo
                  </label>
                  <Input
                    id={`alt-${photo.id}`}
                    value={alt}
                    maxLength={PHOTO_ALT_MAX_LENGTH}
                    placeholder="e.g. Freshly edged lawn in Bedford"
                    disabled={!canEdit}
                    onChange={(event) =>
                      setAltDrafts((drafts) => ({ ...drafts, [photo.id]: event.target.value }))
                    }
                    onBlur={() => {
                      if (canEdit && alt.trim() !== photo.altText) {
                        updateAlt.mutate({ businessId, photoId: photo.id, altText: alt });
                      }
                    }}
                  />
                  {canEdit ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                        aria-label={`Move photo ${index + 1} earlier`}
                      >
                        Earlier
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || index === photos.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label={`Move photo ${index + 1} later`}
                      >
                        Later
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto text-danger hover:text-danger"
                        disabled={busy || deletePhoto.isPending}
                        onClick={() => deletePhoto.mutate({ businessId, photoId: photo.id })}
                        aria-label={`Delete photo ${index + 1}`}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <FilePicker
            label="Add photos"
            multiple
            disabled={busy || remaining <= 0}
            onFiles={(files) => upload("photo", files)}
          />
          {remaining <= 0 ? (
            <span className="text-sm text-muted">
              That's the maximum. Delete one to add another.
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 grid gap-2">
        {progress ? <FormAlert tone="info">{progress}</FormAlert> : null}
        {problem ? <FormAlert tone="error">{problem}</FormAlert> : null}
      </div>
    </Card>
  );
}
