import {
  getAdminApi,
  mutateAdminApi,
  sendAdminBinary,
  type ApiResult,
  type MutationResult,
} from "./client";
import type { OnlineStoreImageDto } from "./online-store";

/**
 * Media asset download links (T3.6) — `GET /media/assets/:mediaAssetId/download-url`
 * (`apps/admin/src/http/media-library-routes.ts`, permission `media_library:get_download_url`)
 * delegates through `MediaLibraryAdminController` to `MediaLibraryController.getDownloadUrl`
 * (`services/media/src/interfaces/media-library.controller.ts`), which calls `GetDownloadUrl.
 * execute` (`services/media/src/application/media-library.use-cases.ts`). That use case 404s when
 * the asset id doesn't exist, otherwise always resolves `ok({ url })` via `ObjectStoragePort.
 * getDownloadUrl(asset.storageKey)`.
 *
 * `GET /media/assets` lists the library (cursor pages; each item carries a resolved `image` for
 * an active image asset since Part 3), read by `fetchLibraryImages` below. Single-asset lookups
 * need the media asset id, which the Product Detail screen has (`product.mediaAssetIds`).
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
  // The product route never answers 422 or 409 in practice; `uploadProductImageAction` maps both
  // to "failed" through its default branch.
  | { readonly outcome: "invalid"; readonly code: string; readonly detail: unknown }
  | { readonly outcome: "conflict" }
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

/** One pickable library image: the asset id (what a section stores), its name and its picture. */
export interface LibraryImageDto {
  readonly id: string;
  readonly name: string;
  readonly image: OnlineStoreImageDto;
}

export interface LibraryImagesPage {
  readonly items: readonly LibraryImageDto[];
  readonly endCursor: string | null;
  readonly hasNextPage: boolean;
}

const LIBRARY_PAGE_SIZE = 24;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNumOrNull = (v: unknown): v is number | null => v === null || typeof v === "number";

interface RawLibraryPage {
  readonly items: readonly unknown[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

function isRawLibraryPage(value: unknown): value is RawLibraryPage {
  if (!isObj(value) || !Array.isArray(value["items"])) return false;
  const info = value["pageInfo"];
  return (
    isObj(info) &&
    typeof info["hasNextPage"] === "boolean" &&
    (info["endCursor"] === null || typeof info["endCursor"] === "string")
  );
}

/** An active asset with a resolved picture; anything else (or a malformed row) is skipped. */
function toLibraryImage(raw: unknown): LibraryImageDto | null {
  if (!isObj(raw) || raw["status"] !== "active") return null;
  const image = raw["image"];
  const id = raw["id"];
  if (typeof id !== "string" || !isObj(image) || typeof image["url"] !== "string") return null;
  const { alt, width, height } = image;
  if ((alt !== null && typeof alt !== "string") || !isNumOrNull(width) || !isNumOrNull(height))
    return null;
  return {
    id,
    name: typeof raw["name"] === "string" ? raw["name"] : "",
    image: { id, url: image["url"], alt, width, height },
  };
}

/**
 * `GET /media/assets?first=24[&after=]` (`media_library:read`), oldest first. Keeps the active
 * assets that resolved to a picture and drops `storageKey` (and everything else) from the rows.
 * `hasNextPage` comes from the API, so a page of non-images is not mistaken for the end.
 */
export async function fetchLibraryImages(
  after: string | null,
): Promise<ApiResult<LibraryImagesPage>> {
  const query = new URLSearchParams({ first: String(LIBRARY_PAGE_SIZE) });
  if (after !== null) query.set("after", after);
  const result = await getAdminApi(`/api/v1/media/assets?${query}`, isRawLibraryPage);
  if (result.outcome !== "ok") return result;
  return {
    outcome: "ok",
    data: {
      items: result.data.items.flatMap((row) => toLibraryImage(row) ?? []),
      endCursor: result.data.pageInfo.endCursor,
      hasNextPage: result.data.pageInfo.hasNextPage,
    },
  };
}
