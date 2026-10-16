import { getAdminApi, mutateAdminApi, sendAdminBinary, type MutationResult } from "./client";

/**
 * Media asset download links (T3.6) — `GET /media/assets/:mediaAssetId/download-url`
 * (`apps/admin/src/http/media-library-routes.ts`, permission `media_library:get_download_url`)
 * delegates through `MediaLibraryAdminController` to `MediaLibraryController.getDownloadUrl`
 * (`services/media/src/interfaces/media-library.controller.ts`), which calls `GetDownloadUrl.
 * execute` (`services/media/src/application/media-library.use-cases.ts`). That use case 404s when
 * the asset id doesn't exist, otherwise always resolves `ok({ url })` via `ObjectStoragePort.
 * getDownloadUrl(asset.storageKey)`.
 *
 * There is no `GET /media/assets` list endpoint (see `docs/plans/BLOCKERS.md`), so this module
 * exposes only the single-asset lookup — callers must already know the media asset id, which the
 * Product Detail screen does (`product.mediaAssetIds` from `GET /products/:productId`).
 *
 * In `local` (the only env this repo runs test/dev in), the object storage port is
 * `InMemoryObjectStorage`, whose `getDownloadUrl` returns a URL template that was never wired to
 * real storage — the returned link will not resolve to a file. That is expected, not a bug this
 * module should work around: it renders exactly the URL the API issues, same as every other fetch
 * module in this directory.
 */

interface DownloadUrlOutput {
  readonly url: string;
}

function isDownloadUrlOutput(value: unknown): value is DownloadUrlOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { url?: unknown }).url === "string"
  );
}

export type FetchMediaDownloadUrlResult =
  | { readonly outcome: "ok"; readonly url: string }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a one-off download URL for a single media asset. */
export async function fetchMediaDownloadUrl(
  mediaAssetId: string,
): Promise<FetchMediaDownloadUrlResult> {
  const result = await getAdminApi(
    `/api/v1/media/assets/${encodeURIComponent(mediaAssetId)}/download-url`,
    isDownloadUrlOutput,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", url: result.data.url };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  if (result.outcome === "not_found") {
    return { outcome: "not_found" };
  }
  return { outcome: "error", message: result.message };
}

/** What the staff API returns for a stored image (`POST /media/uploads`): no storage key. */
export interface UploadedImageDto {
  readonly id: string;
  readonly url: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

function isUploadedImage(value: unknown): value is UploadedImageDto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["id"] === "string" && typeof v["url"] === "string";
}

export type UploadProductImageResult =
  | { readonly outcome: "ok"; readonly image: UploadedImageDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "unavailable" }
  | { readonly outcome: "too_large" }
  | { readonly outcome: "unsupported" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `POST /media/uploads` (`products:update`) — one image, as raw bytes. The runtime checks the bytes
 * (JPEG, PNG, WebP or GIF — never SVG), caps them at 8 MB, stores them under the tenant's own key
 * prefix and answers `503` while image storage isn't set up. The file name travels percent-encoded.
 */
export async function uploadProductImage(input: {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
  readonly idempotencyKey: string;
}): Promise<UploadProductImageResult> {
  const result = await sendAdminBinary(
    "/api/v1/media/uploads",
    {
      body: input.bytes,
      contentType: input.contentType,
      idempotencyKey: input.idempotencyKey,
      headers: { "x-file-name": encodeURIComponent(input.fileName) },
    },
    isUploadedImage,
  );
  return result.outcome === "ok" ? { outcome: "ok", image: result.data } : result;
}

/** `PATCH /media/assets/:id` (`products:update`) — sets the alt text, or clears it with `null`/blank. */
export function updateMediaAlt(
  mediaAssetId: string,
  alt: string | null,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/media/assets/${encodeURIComponent(mediaAssetId)}`,
    { method: "PATCH", body: { alt }, idempotencyKey },
    (_value): _value is unknown => true,
  );
}
