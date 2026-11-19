"use server";

import {
  uploadOnlineStoreImage,
  type OnlineStoreImageDto,
  type OnlineStoreImagePurpose,
} from "@/lib/api/online-store";
import { newIdempotencyKey } from "@/lib/api/mutation";
import { checkUpload } from "@/lib/online-store/upload-rules";

export type OnlineStoreUploadErrorReason =
  | "unavailable"
  | "too_large"
  | "unsupported"
  | "bad_dimensions"
  | "too_many_pixels"
  | "invalid_purpose"
  | "in_flight"
  | "forbidden"
  | "failed";

export type OnlineStoreUploadState =
  | { readonly status: "ok"; readonly image: OnlineStoreImageDto }
  | { readonly status: "error"; readonly reason: OnlineStoreUploadErrorReason };

const PURPOSES: readonly OnlineStoreImagePurpose[] = [
  "logo",
  "favicon",
  "share_image",
  "section_image",
];

/** 422 codes the upload route sends (`MediaLibraryController.uploadImage` and the route schema). */
const INVALID_REASONS: Readonly<Record<string, OnlineStoreUploadErrorReason>> = {
  BAD_DIMENSIONS: "bad_dimensions",
  IMAGE_TOO_LARGE_DIMENSIONS: "too_many_pixels",
  INVALID_PURPOSE: "invalid_purpose",
  // The route's strict `purpose` query refuses anything else with the generic validation code.
  VALIDATION: "invalid_purpose",
};

/**
 * Uploads one Online Store image (shared by Preferences and the theme editor). Ruling 19: the
 * original bytes are sent (no WebP re-encode); the server sniffs them and decides. The answer is a
 * reason the screen maps to its own copy, never the server's text.
 */
export async function uploadOnlineStoreImageAction(
  formData: FormData,
): Promise<OnlineStoreUploadState> {
  const file = formData.get("file");
  const purpose = formData.get("purpose");
  if (!PURPOSES.includes(purpose as OnlineStoreImagePurpose)) {
    return { status: "error", reason: "invalid_purpose" };
  }
  if (!(file instanceof File) || file.size === 0) return { status: "error", reason: "unsupported" };
  const early = checkUpload(file, purpose as OnlineStoreImagePurpose);
  if (early !== "ok") return { status: "error", reason: early };
  const result = await uploadOnlineStoreImage({
    bytes: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type,
    fileName: file.name,
    purpose: purpose as OnlineStoreImagePurpose,
    idempotencyKey: newIdempotencyKey(),
  });
  switch (result.outcome) {
    case "ok":
      return { status: "ok", image: result.data };
    case "unauthorized":
      return { status: "error", reason: "forbidden" };
    case "unavailable":
    case "too_large":
    case "unsupported":
      return { status: "error", reason: result.outcome };
    case "invalid":
      return { status: "error", reason: INVALID_REASONS[result.code] ?? "failed" };
    case "conflict":
      return { status: "error", reason: "in_flight" };
    default:
      return { status: "error", reason: "failed" };
  }
}
