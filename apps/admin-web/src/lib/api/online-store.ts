import {
  readThemeDocument,
  type ContrastWarning,
  type LocalizedText,
  type ThemeDocument,
} from "@platform/storefront-content";
import {
  getAdminApi,
  mutateAdminApi,
  sendAdminBinary,
  type ApiResult,
  type BinaryResult,
  type MutationResult,
} from "./client";

/**
 * Online Store (Project 4) — `apps/admin/src/http/online-store-routes.ts`. Server only (Global
 * Constraint 7): client components import TYPES from here, never values.
 */
export type OnlineStoreImagePurpose = "logo" | "favicon" | "share_image" | "section_image";

export interface OnlineStoreImageDto {
  readonly id?: string;
  readonly url: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}
export interface PreferencesDto {
  readonly homeTitle: LocalizedText;
  readonly homeMetaDescription: LocalizedText;
  /** The resolved image, or null when none is set OR the stored one no longer resolves (archived). */
  readonly shareImage: OnlineStoreImageDto | null;
  /** The stored ref (F4): the resolved image carries no id, and a save must send this back. */
  readonly shareImageId: string | null;
  readonly defaultLocale: "ar" | "en";
  readonly storeName: string;
  readonly version: number;
}
/** Never the password or its hash (spec 1.5): only whether one is set and when it last changed. */
export interface AccessDto {
  readonly locked: boolean;
  readonly passwordSet: boolean;
  readonly passwordUpdatedAt: string | null;
  readonly message: LocalizedText;
  readonly version: number;
}
export interface ThemeStateDto {
  readonly draft: ThemeDocument;
  readonly published: ThemeDocument | null;
  readonly draftRevision: number;
  readonly draftSavedAt: string | null;
  readonly publishedDraftRevision: number | null;
  readonly releaseNumber: number;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  readonly hasUnpublishedChanges: boolean;
  readonly images: Readonly<Record<string, OnlineStoreImageDto>>;
  readonly version: number;
}
export interface SaveDraftResultDto {
  readonly draftRevision: number;
  readonly version: number;
  readonly warnings: readonly ContrastWarning[];
}
export interface DraftRevisionDto {
  readonly draftRevision: number;
  readonly version: number;
}
export interface PublishResultDto {
  readonly releaseNumber: number;
  readonly publishedAt: string;
}
export interface ReleaseDto {
  readonly releaseNumber: number;
  readonly publishedAt: string;
  readonly publishedByName: string | null;
}
export interface PreviewTokenDto {
  readonly token: string;
  readonly expiresAt: string;
  readonly url: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isPreferences(v: unknown): v is PreferencesDto {
  return (
    isObject(v) &&
    isObject(v["homeTitle"]) &&
    isObject(v["homeMetaDescription"]) &&
    (v["shareImage"] === null || isObject(v["shareImage"])) &&
    (v["shareImageId"] === null || typeof v["shareImageId"] === "string") &&
    (v["defaultLocale"] === "ar" || v["defaultLocale"] === "en") &&
    typeof v["storeName"] === "string" &&
    isNumber(v["version"])
  );
}
function isAccess(v: unknown): v is AccessDto {
  return (
    isObject(v) &&
    typeof v["locked"] === "boolean" &&
    typeof v["passwordSet"] === "boolean" &&
    isObject(v["message"]) &&
    isNumber(v["version"])
  );
}
function isThemeState(v: unknown): v is ThemeStateDto {
  return (
    isObject(v) &&
    "draft" in v &&
    isNumber(v["draftRevision"]) &&
    isNumber(v["version"]) &&
    typeof v["hasUnpublishedChanges"] === "boolean" &&
    isObject(v["images"])
  );
}
const isDraftRevision = (v: unknown): v is DraftRevisionDto =>
  isObject(v) && isNumber(v["draftRevision"]) && isNumber(v["version"]);
const isSaveDraft = (v: unknown): v is SaveDraftResultDto =>
  isObject(v) && isDraftRevision(v) && Array.isArray(v["warnings"]);
const isPublish = (v: unknown): v is PublishResultDto =>
  isObject(v) && isNumber(v["releaseNumber"]) && typeof v["publishedAt"] === "string";
const isReleases = (v: unknown): v is { releases: ReleaseDto[] } =>
  isObject(v) && Array.isArray(v["releases"]);
const isToken = (v: unknown): v is PreviewTokenDto =>
  isObject(v) && typeof v["token"] === "string" && typeof v["expiresAt"] === "string";
const isImage = (v: unknown): v is OnlineStoreImageDto =>
  isObject(v) && typeof v["id"] === "string" && typeof v["url"] === "string";

/** `GET /online-store/preferences` (`online_store:read`). */
export function fetchPreferences(): Promise<ApiResult<PreferencesDto>> {
  return getAdminApi("/api/v1/online-store/preferences", isPreferences);
}

/** `PUT /online-store/preferences` (`online_store:update_preferences`), live on save. */
export function updatePreferences(
  body: {
    homeTitle: LocalizedText;
    homeMetaDescription: LocalizedText;
    shareImageId: string | null;
    defaultLocale: "ar" | "en";
    expectedVersion: number;
  },
  idempotencyKey: string,
): Promise<MutationResult<PreferencesDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/preferences",
    { method: "PUT", body, idempotencyKey },
    isPreferences,
  );
}

/** `GET /online-store/access` (`online_store:read`). */
export function fetchAccess(): Promise<ApiResult<AccessDto>> {
  return getAdminApi("/api/v1/online-store/access", isAccess);
}

/** `PUT /online-store/access` (`online_store_admin:update_access`, admin only). `null` keeps the password. */
export function updateAccess(
  body: {
    locked: boolean;
    password: string | null;
    message: LocalizedText;
    expectedVersion: number;
  },
  idempotencyKey: string,
): Promise<MutationResult<AccessDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/access",
    { method: "PUT", body, idempotencyKey },
    isAccess,
  );
}

/** The documents are re-read through the shared reader, so the editor always holds a canonical shape. */
export async function fetchThemeState(): Promise<ApiResult<ThemeStateDto>> {
  const result = await getAdminApi("/api/v1/online-store/theme", isThemeState);
  if (result.outcome !== "ok") return result;
  return {
    outcome: "ok",
    data: {
      ...result.data,
      draft: readThemeDocument(result.data.draft),
      published: result.data.published === null ? null : readThemeDocument(result.data.published),
    },
  };
}

export function saveThemeDraft(
  document: ThemeDocument,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MutationResult<SaveDraftResultDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/theme/draft",
    { method: "PUT", body: { document, expectedVersion }, idempotencyKey },
    isSaveDraft,
  );
}

export function discardThemeDraft(
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MutationResult<DraftRevisionDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/theme/discard-draft",
    { method: "POST", body: { expectedVersion }, idempotencyKey },
    isDraftRevision,
  );
}

export function publishTheme(
  expectedDraftRevision: number,
  idempotencyKey: string,
): Promise<MutationResult<PublishResultDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/theme/publish",
    { method: "POST", body: { expectedDraftRevision }, idempotencyKey },
    isPublish,
  );
}

export async function fetchThemeReleases(): Promise<ApiResult<readonly ReleaseDto[]>> {
  const result = await getAdminApi("/api/v1/online-store/theme/releases", isReleases);
  return result.outcome === "ok" ? { outcome: "ok", data: result.data.releases } : result;
}

export function restoreThemeRelease(
  releaseNumber: number,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MutationResult<DraftRevisionDto>> {
  return mutateAdminApi(
    `/api/v1/online-store/theme/releases/${encodeURIComponent(String(releaseNumber))}/restore`,
    { method: "POST", body: { expectedVersion }, idempotencyKey },
    isDraftRevision,
  );
}

/** NOT idempotent on purpose (binding lesson): no Idempotency-Key, so a token is never replayed. */
export function issuePreviewToken(): Promise<MutationResult<PreviewTokenDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/preview-tokens",
    { method: "POST", body: {} },
    isToken,
  );
}

/** `POST /online-store/images?purpose=…` (`online_store:upload_image`): raw bytes, checked per purpose. */
export function uploadOnlineStoreImage(input: {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
  readonly purpose: OnlineStoreImagePurpose;
  readonly idempotencyKey: string;
}): Promise<BinaryResult<OnlineStoreImageDto>> {
  return sendAdminBinary(
    `/api/v1/online-store/images?purpose=${encodeURIComponent(input.purpose)}`,
    {
      body: input.bytes,
      contentType: input.contentType,
      idempotencyKey: input.idempotencyKey,
      headers: { "x-file-name": encodeURIComponent(input.fileName) },
    },
    isImage,
  );
}
