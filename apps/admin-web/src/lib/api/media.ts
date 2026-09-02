import { getAdminApi } from "./client";

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
