"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { newIdempotencyKey, type FormState } from "@/lib/api/mutation";
import {
  archiveMediaFile,
  fetchMediaDownloadUrl,
  updateMediaAlt,
  uploadProductImage,
  type UploadedImageDto,
} from "@/lib/api/media";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Content > Files server actions. The API enforces every permission (`media_library:*`,
 * `products:update`); these only shape input and outcomes. Every action that reached the API
 * revalidates `/content/files` whether or not it succeeded, so a refused or half-applied write is
 * never followed by a stale list.
 */

const FILES_PATH = "/content/files";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_ALT_LENGTH = 512;

async function localeDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

export type UploadFileState =
  | { readonly status: "ok"; readonly image: UploadedImageDto }
  | {
      readonly status: "error";
      readonly reason: "too_large" | "unsupported" | "unavailable" | "failed";
    };

/**
 * Uploads ONE file (the browser has already scaled and re-encoded it with `prepareImage`; the
 * runtime checks the bytes again). The upload button calls this once per file, so every file gets its
 * own idempotency key. Same checks and outcome mapping as `uploadProductImageAction`.
 */
export async function uploadFileAction(formData: FormData): Promise<UploadFileState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", reason: "unsupported" };
  if (file.size > MAX_UPLOAD_BYTES) return { status: "error", reason: "too_large" };

  const result = await uploadProductImage({
    bytes: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type,
    fileName: file.name,
    idempotencyKey: newIdempotencyKey(),
  });
  revalidatePath(FILES_PATH);
  switch (result.outcome) {
    case "ok":
      return { status: "ok", image: result.image };
    case "unavailable":
      return { status: "error", reason: "unavailable" };
    case "too_large":
      return { status: "error", reason: "too_large" };
    case "unsupported":
      return { status: "error", reason: "unsupported" };
    default:
      return { status: "error", reason: "failed" };
  }
}

/** Sets or clears (blank) one file's alt text. */
export async function updateFileAltAction(mediaAssetId: string, alt: string): Promise<FormState> {
  const t = await localeDictionary();
  if (mediaAssetId.length === 0) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }
  const trimmed = alt.trim();
  if (trimmed.length > MAX_ALT_LENGTH) {
    const message = t.files.details.altTooLong;
    return { status: "error", message, fieldErrors: { alt: message } };
  }

  const result = await updateMediaAlt(
    mediaAssetId,
    trimmed.length === 0 ? null : trimmed,
    newIdempotencyKey(),
  );
  revalidatePath(FILES_PATH);
  switch (result.outcome) {
    case "ok":
      return { status: "success" };
    case "unauthorized":
      return { status: "error", message: t.formErrors.unauthorized, fieldErrors: {} };
    case "forbidden":
      return { status: "error", message: t.formErrors.forbidden, fieldErrors: {} };
    case "not_found":
      return { status: "error", message: t.formErrors.notFound, fieldErrors: {} };
    case "conflict":
      return { status: "error", message: t.formErrors.conflict, fieldErrors: {} };
    case "invalid":
      return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
    case "error":
      return { status: "error", message: t.formErrors.unexpected, fieldErrors: {} };
  }
}

/**
 * "Delete file" — archives the asset. A `409 BUSINESS_RULE` means it was already archived; any
 * other 409 is an in-flight idempotency key (a double submit), which is not "already deleted".
 */
export async function archiveFileAction(mediaAssetId: string): Promise<FormState> {
  const t = await localeDictionary();
  if (mediaAssetId.length === 0) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }

  const result = await archiveMediaFile(mediaAssetId, newIdempotencyKey());
  revalidatePath(FILES_PATH);
  switch (result.outcome) {
    case "ok":
      return { status: "success" };
    case "conflict":
      return {
        status: "error",
        message:
          result.code === "BUSINESS_RULE" ? t.files.delete.alreadyDeleted : t.formErrors.conflict,
        fieldErrors: {},
      };
    case "not_found":
      return { status: "error", message: t.formErrors.notFound, fieldErrors: {} };
    case "forbidden":
      return { status: "error", message: t.formErrors.forbidden, fieldErrors: {} };
    case "unauthorized":
      return { status: "error", message: t.formErrors.unauthorized, fieldErrors: {} };
    default:
      return { status: "error", message: t.formErrors.unexpected, fieldErrors: {} };
  }
}

export type FileDownloadState =
  | { readonly status: "ok"; readonly url: string }
  | { readonly status: "error"; readonly message: string };

/** A signed download link for one file (a read, so nothing to revalidate). */
export async function getFileDownloadUrlAction(mediaAssetId: string): Promise<FileDownloadState> {
  const t = await localeDictionary();
  if (mediaAssetId.length === 0) {
    return { status: "error", message: t.formErrors.invalid };
  }

  const result = await fetchMediaDownloadUrl(mediaAssetId);
  switch (result.outcome) {
    case "ok":
      // Only a web URL is ever opened by the browser (never `javascript:` or `data:`).
      return /^https?:\/\//i.test(result.url)
        ? { status: "ok", url: result.url }
        : { status: "error", message: t.files.details.downloadFailed };
    case "unauthorized":
      return { status: "error", message: t.formErrors.forbidden };
    case "not_found":
      return { status: "error", message: t.formErrors.notFound };
    case "error":
      return { status: "error", message: t.formErrors.unexpected };
  }
}
