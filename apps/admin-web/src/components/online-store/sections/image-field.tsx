"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { Button, Input, Label } from "@platform/ui";
import { IMAGE_ALT_MAX } from "@platform/storefront-content";
import { updateImageAltAction } from "@/app/online-store/themes/actions";
import type { OnlineStoreImageDto } from "@/lib/api/online-store";
import { settleAction } from "@/lib/online-store/settle-action";
import type { Dictionary } from "@/messages/en";
import { ImageUploadField } from "../image-upload-field";
import { errorAria, FieldError } from "./field-shared";
import { MediaLibraryDialog } from "./media-library-dialog";

type StoredImage = OnlineStoreImageDto & { readonly id: string };

/**
 * The alt text belongs to the asset (spec 1.7), so it is saved on blur through the existing media
 * route and changes everywhere the image is used. A failed or thrown save is the localised error.
 * Keyed by the image, so picking another image starts from its own text.
 */
function AltText({
  t,
  id,
  image,
  disabled,
  onImage,
}: {
  readonly t: Dictionary;
  readonly id: string;
  readonly image: StoredImage;
  readonly disabled: boolean;
  readonly onImage: (image: StoredImage) => void;
}) {
  const c = t.onlineStoreSections.image;
  const [text, setText] = useState(image.alt ?? "");
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const save = () => {
    const next = text.trim();
    if (next === (image.alt ?? "").trim() || pending) return;
    start(async () => {
      const result = await settleAction(() => updateImageAltAction(image.id, next), {
        status: "error",
      } as const);
      if (result.status === "ok") {
        setFailed(false);
        onImage({ ...image, alt: next === "" ? null : next });
      } else {
        setFailed(true);
      }
    });
  };
  const error = failed ? c.altError : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        <bdi>{c.alt}</bdi>
      </Label>
      <Input
        id={id}
        dir="auto"
        maxLength={IMAGE_ALT_MAX}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={save}
        {...errorAria(id, error)}
      />
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One image of a section: its picture and alt text, Upload (Part 1's field, purpose
 * `section_image`), Choose from library, and Remove (stores `null`). A reference the editor has no
 * picture for says it was removed, with Remove beside it. Uploads and library picks are registered
 * with the editor through `onImage` before the reference is stored.
 */
export function SectionImageField({
  t,
  id,
  label,
  value,
  images,
  disabled,
  error,
  onChange,
  onImage,
}: {
  readonly t: Dictionary;
  readonly id: string;
  readonly label: string;
  readonly value: string | null;
  readonly images: Readonly<Record<string, OnlineStoreImageDto>>;
  readonly disabled: boolean;
  readonly error?: string | undefined;
  readonly onChange: (ref: string | null) => void;
  readonly onImage: (image: StoredImage) => void;
}) {
  const c = t.onlineStoreSections.image;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const found = value !== null && Object.hasOwn(images, value) ? images[value] : undefined;
  const choose = (image: StoredImage) => {
    onImage(image);
    onChange(image.id);
  };
  const remove = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={() => onChange(null)}
    >
      {c.remove}
    </Button>
  );
  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-labelledby={`${id}-label`}
      {...errorAria(id, error)}
    >
      <span id={`${id}-label`} className="text-foreground text-base font-medium leading-none">
        <bdi>{label}</bdi>
      </span>
      {value === null ? null : found === undefined ? (
        <div className="flex items-center gap-2">
          <p className="text-muted-foreground text-sm">{c.removed}</p>
          {remove}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Image
            src={found.url}
            alt={found.alt ?? ""}
            width={found.width ?? 128}
            height={found.height ?? 128}
            unoptimized
            className="border-border max-h-32 w-auto self-start rounded-lg border object-contain"
          />
          <AltText
            key={value}
            t={t}
            id={`${id}-alt`}
            image={{ ...found, id: value }}
            disabled={disabled}
            onImage={onImage}
          />
          <div>{remove}</div>
        </div>
      )}
      <ImageUploadField
        t={t}
        purpose="section_image"
        image={null}
        disabled={disabled}
        onChange={(image) => {
          if (image !== null) choose(image);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="self-start"
        disabled={disabled}
        onClick={() => setLibraryOpen(true)}
      >
        {c.library}
      </Button>
      <MediaLibraryDialog t={t} open={libraryOpen} onOpenChange={setLibraryOpen} onPick={choose} />
      <FieldError id={id} error={error} />
    </div>
  );
}
