"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { Button } from "@platform/ui";
import { uploadOnlineStoreImageAction } from "@/app/online-store/actions";
import type { OnlineStoreImageDto, OnlineStoreImagePurpose } from "@/lib/api/online-store";
import { UPLOAD_RULES } from "@/lib/online-store/upload-rules";
import type { Dictionary } from "@/messages/en";

type StoredImage = OnlineStoreImageDto & { readonly id: string };

/**
 * Upload → returns the media id; `name` (if given) carries it in the surrounding form. Errors are
 * the dictionary's copy for the action's reason, never the server's text. The picked file's name is
 * shown as plain text only (React escapes it; it is never markup or an attribute).
 */
export function ImageUploadField({
  t,
  purpose,
  name,
  image,
  disabled = false,
  onChange,
}: {
  readonly t: Dictionary;
  readonly purpose: OnlineStoreImagePurpose;
  readonly name?: string;
  readonly image: StoredImage | null;
  readonly disabled?: boolean;
  readonly onChange: (image: StoredImage | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const onFile = (file: File | undefined) => {
    if (file === undefined) return;
    const form = new FormData();
    form.set("file", file);
    form.set("purpose", purpose);
    start(async () => {
      const result = await uploadOnlineStoreImageAction(form);
      if (result.status === "ok" && typeof result.image.id === "string") {
        setError(null);
        setFileName(file.name);
        onChange({ ...result.image, id: result.image.id });
      } else if (result.status === "error") {
        setError(t.onlineStorePreferences.uploadErrors[result.reason]);
      } else {
        setError(t.onlineStorePreferences.uploadErrors.failed);
      }
      if (input.current !== null) input.current.value = "";
    });
  };
  return (
    <div className="flex flex-col gap-2">
      {name === undefined ? null : <input type="hidden" name={name} value={image?.id ?? ""} />}
      {image === null ? null : (
        <Image
          src={image.url}
          alt={image.alt ?? ""}
          width={image.width ?? 128}
          height={image.height ?? 128}
          unoptimized
          className="border-border max-h-32 w-auto self-start rounded-lg border object-contain"
        />
      )}
      {image === null || fileName === null ? null : (
        <p className="text-muted-foreground text-xs">
          {t.onlineStorePreferences.uploadedFile}{" "}
          <bdi dir="auto" className="break-all">
            {fileName}
          </bdi>
        </p>
      )}
      <div className="flex gap-2">
        <input
          ref={input}
          type="file"
          accept={UPLOAD_RULES[purpose].types.join(",")}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          disabled={disabled}
          onChange={(e) => onFile(e.currentTarget.files?.[0])}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || pending}
          loading={pending}
          onClick={() => input.current?.click()}
        >
          {pending ? t.onlineStorePreferences.uploading : t.onlineStorePreferences.upload}
        </Button>
        {image === null || disabled ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFileName(null);
              onChange(null);
            }}
          >
            {t.onlineStorePreferences.shareRemove}
          </Button>
        )}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
