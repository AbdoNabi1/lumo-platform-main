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

/**
 * One row of the Files page — `MediaAssetDto` of `apps/admin/src/http/media-library-routes.ts`
 * (never the storage key). `image` is the resolved picture of an active image asset, else `null`.
 */
export interface MediaFileDto {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly contentType: string | null;
  readonly byteSize: number | null;
  readonly createdAt: string | null;
  readonly image: {
    readonly url: string;
    readonly alt: string | null;
    readonly width: number | null;
    readonly height: number | null;
  } | null;
}

export interface MediaFilesPage {
  readonly items: readonly MediaFileDto[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

function isMediaFileDto(value: unknown): value is MediaFileDto {
  if (!isObj(value)) return false;
  if (typeof value["id"] !== "string" || typeof value["name"] !== "string") return false;
  if (typeof value["status"] !== "string") return false;
  if (!isStrOrNull(value["contentType"]) || !isNumOrNull(value["byteSize"])) return false;
  if (!isStrOrNull(value["createdAt"])) return false;
  const image = value["image"];
  if (image === null) return true;
  return (
    isObj(image) &&
    typeof image["url"] === "string" &&
    isStrOrNull(image["alt"]) &&
    isNumOrNull(image["width"]) &&
    isNumOrNull(image["height"])
  );
}

/** Checks every field the Files page reads, so a malformed row is an error, not a render crash. */
export function isMediaFilesPage(value: unknown): value is MediaFilesPage {
  if (!isObj(value) || !Array.isArray(value["items"])) return false;
  if (!value["items"].every(isMediaFileDto)) return false;
  const info = value["pageInfo"];
  return (
    isObj(info) &&
    typeof info["hasNextPage"] === "boolean" &&
    (info["endCursor"] === null || typeof info["endCursor"] === "string")
  );
}

const FILES_PAGE_SIZE = 50;

/** Copies exactly the fields of {@link MediaFileDto}, dropping everything else the API sent. */
function toMediaFile(row: MediaFileDto): MediaFileDto {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    contentType: row.contentType,
    byteSize: row.byteSize,
    createdAt: row.createdAt,
    image:
      row.image === null
        ? null
        : {
            url: row.image.url,
            alt: row.image.alt,
            width: row.image.width,
            height: row.image.height,
          },
  };
}

/**
 * `GET /media/assets?status=active&…` (`media_library:read`) — the Files page's list. Always
 * `status=active` (a deleted file is archived), 50 per page unless told otherwise.
 */
export async function fetchMediaFilesPage(input: {
  readonly first?: number;
  readonly after?: string;
  readonly search?: string;
  readonly sort?: "newest" | "oldest";
}): Promise<ApiResult<MediaFilesPage>> {
  const params = new URLSearchParams({
    status: "active",
    first: String(input.first ?? FILES_PAGE_SIZE),
  });
  if (input.after !== undefined && input.after !== "") params.set("after", input.after);
  if (input.search !== undefined && input.search !== "") params.set("search", input.search);
  if (input.sort !== undefined) params.set("sort", input.sort);
  const result = await getAdminApi(`/api/v1/media/assets?${params}`, isMediaFilesPage);
  if (result.outcome !== "ok") return result;
  // The API row also carries `storageKey` and `folderRef`; neither belongs in the page's props.
  return {
    outcome: "ok",
    data: {
      items: result.data.items.map(toMediaFile),
      pageInfo: {
        hasNextPage: result.data.pageInfo.hasNextPage,
        endCursor: result.data.pageInfo.endCursor,
      },
    },
  };
}

function isArchivedDto(value: unknown): value is { readonly mediaAssetId: string } {
  return isObj(value) && typeof value["mediaAssetId"] === "string";
}

/** `POST /media/assets/:id/archive` (`media_library:archive_asset`) — the Files page's "Delete file". */
export function archiveMediaFile(
  mediaAssetId: string,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly mediaAssetId: string }>> {
  return mutateAdminApi(
    `/api/v1/media/assets/${encodeURIComponent(mediaAssetId)}/archive`,
    { method: "POST", idempotencyKey },
    isArchivedDto,
  );
}
