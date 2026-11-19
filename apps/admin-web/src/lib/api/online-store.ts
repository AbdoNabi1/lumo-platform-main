import {
  isPolicyType,
  readThemeDocument,
  type ContrastWarning,
  type LocalizedText,
  type MenuItem,
  type PolicyType,
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
/**
 * What the draft's collection, product and page references point to (Ruling 21): id to its title and
 * whether it is live. An id that is absent no longer exists. Look ids up with `Object.hasOwn`.
 */
export type ThemeTargetsDto = Readonly<
  Record<
    "collection" | "product" | "page",
    Readonly<Record<string, { readonly title: string; readonly live: boolean }>>
  >
>;
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
  /** `null` when the API could not resolve them (or an older API sends none): no flags then. */
  readonly targets: ThemeTargetsDto | null;
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
function isTargetBucket(v: unknown): boolean {
  return (
    isObject(v) &&
    !Array.isArray(v) &&
    Object.values(v).every(
      (entry) =>
        isObject(entry) && typeof entry["title"] === "string" && typeof entry["live"] === "boolean",
    )
  );
}
/** `null`, or the three buckets. An absent value is handled by the caller (F18). */
function isTargets(v: unknown): v is ThemeTargetsDto {
  return (
    isObject(v) &&
    isTargetBucket(v["collection"]) &&
    isTargetBucket(v["product"]) &&
    isTargetBucket(v["page"])
  );
}
function isThemeState(v: unknown): v is ThemeStateDto {
  return (
    isObject(v) &&
    "draft" in v &&
    isNumber(v["draftRevision"]) &&
    isNumber(v["version"]) &&
    typeof v["hasUnpublishedChanges"] === "boolean" &&
    isObject(v["images"]) &&
    (!("targets" in v) || v["targets"] === null || isTargets(v["targets"]))
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
      targets: result.data.targets ?? null,
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

/* ------------------------------------------------------------------------------------------------
 * Part 2 (spec 2.6): menus and the link picker. Reads need `online_store:read`; writes need
 * `online_store:manage_menus` and carry one Idempotency-Key per submit.
 * ---------------------------------------------------------------------------------------------- */

/** The link picker's kinds (`home`, `search` and `url` need no search). */
export type LinkTargetType = "collection" | "product" | "page" | "policy";

/** One row of the menu list (Ruling 29): up to five top-level labels. */
export interface MenuSummaryDto {
  readonly id: string | null;
  readonly handle: string;
  readonly title: string;
  readonly itemCount: number;
  readonly isDefault: boolean;
  readonly topLabels: readonly LocalizedText[];
}
/**
 * A menu item with its link's current state: `broken` when the target is gone or unpublished,
 * `targetTitle` the target's title (null for home and search; the raw type for a policy, so a
 * screen names policies itself).
 */
export interface MenuItemViewDto extends Omit<MenuItem, "children"> {
  readonly broken: boolean;
  readonly targetTitle: string | null;
  readonly children: readonly MenuItemViewDto[];
}
/** `id` is null and `version` 0 for a default menu never saved. */
export interface MenuDto {
  readonly id: string | null;
  readonly handle: string;
  readonly title: string;
  readonly isDefault: boolean;
  readonly version: number;
  readonly items: readonly MenuItemViewDto[];
}
export interface LinkTargetDto {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
}

const isNullableString = (v: unknown): v is string | null => v === null || typeof v === "string";

/** Two levels at most (spec 2.2): a child with children of its own is not a menu we can edit. */
function isMenuItemView(v: unknown, depth: 1 | 2 = 1): v is MenuItemViewDto {
  if (!isObject(v)) return false;
  const link = v["link"];
  const children = v["children"];
  return (
    typeof v["id"] === "string" &&
    isObject(v["label"]) &&
    isObject(link) &&
    typeof link["type"] === "string" &&
    typeof v["broken"] === "boolean" &&
    isNullableString(v["targetTitle"]) &&
    Array.isArray(children) &&
    (depth === 2
      ? children.length === 0
      : children.every((child: unknown) => isMenuItemView(child, 2)))
  );
}
function isMenu(v: unknown): v is MenuDto {
  return (
    isObject(v) &&
    isNullableString(v["id"]) &&
    typeof v["handle"] === "string" &&
    typeof v["title"] === "string" &&
    typeof v["isDefault"] === "boolean" &&
    isNumber(v["version"]) &&
    Array.isArray(v["items"]) &&
    v["items"].every((item) => isMenuItemView(item))
  );
}
function isMenuSummary(v: unknown): v is MenuSummaryDto {
  return (
    isObject(v) &&
    isNullableString(v["id"]) &&
    typeof v["handle"] === "string" &&
    typeof v["title"] === "string" &&
    isNumber(v["itemCount"]) &&
    typeof v["isDefault"] === "boolean" &&
    Array.isArray(v["topLabels"]) &&
    v["topLabels"].every(isObject)
  );
}
const isMenuList = (v: unknown): v is { menus: MenuSummaryDto[] } =>
  isObject(v) && Array.isArray(v["menus"]) && v["menus"].every(isMenuSummary);
const isDeletedMenu = (v: unknown): v is { handle: string } =>
  isObject(v) && typeof v["handle"] === "string";
const isLinkTarget = (v: unknown): v is LinkTargetDto =>
  isObject(v) &&
  typeof v["id"] === "string" &&
  typeof v["title"] === "string" &&
  typeof v["subtitle"] === "string";
const isLinkTargets = (v: unknown): v is { targets: LinkTargetDto[] } =>
  isObject(v) && Array.isArray(v["targets"]) && v["targets"].every(isLinkTarget);

const menuPath = (handle: string) => `/api/v1/online-store/menus/${encodeURIComponent(handle)}`;

/** `GET /online-store/menus`: main menu and footer first (saved or default), then by handle. */
export async function fetchMenus(): Promise<ApiResult<readonly MenuSummaryDto[]>> {
  const result = await getAdminApi("/api/v1/online-store/menus", isMenuList);
  return result.outcome === "ok" ? { outcome: "ok", data: result.data.menus } : result;
}

/** `GET /online-store/menus/:handle`: the items with each link's current target. */
export function fetchMenu(handle: string): Promise<ApiResult<MenuDto>> {
  return getAdminApi(menuPath(handle), isMenu);
}

/** `POST /online-store/menus` (at most 50 custom menus; the main menu and footer do not count). */
export function createMenu(
  body: { handle: string; title: string; items: readonly MenuItem[] },
  idempotencyKey: string,
): Promise<MutationResult<MenuDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/menus",
    { method: "POST", body, idempotencyKey },
    isMenu,
  );
}

/** `PUT /online-store/menus/:handle`: replaces the title and items (a default menu's first save creates it). */
export function updateMenu(
  handle: string,
  body: { title: string; items: readonly MenuItem[]; expectedVersion: number },
  idempotencyKey: string,
): Promise<MutationResult<MenuDto>> {
  return mutateAdminApi(menuPath(handle), { method: "PUT", body, idempotencyKey }, isMenu);
}

/** `DELETE /online-store/menus/:handle`: no body (never the main menu or footer, nor one the theme shows). */
export function deleteMenu(
  handle: string,
  idempotencyKey: string,
): Promise<MutationResult<{ handle: string }>> {
  return mutateAdminApi(menuPath(handle), { method: "DELETE", idempotencyKey }, isDeletedMenu);
}

/** `GET /online-store/link-targets?type=&q=`: up to 20 choices of one kind. */
export async function searchLinkTargets(
  type: LinkTargetType,
  q: string,
): Promise<ApiResult<readonly LinkTargetDto[]>> {
  const query = new URLSearchParams({ type, q });
  const result = await getAdminApi(`/api/v1/online-store/link-targets?${query}`, isLinkTargets);
  return result.outcome === "ok" ? { outcome: "ok", data: result.data.targets } : result;
}

/* ------------------------------------------------------------------------------------------------
 * Part 2 (spec 2.3): store policies. Reads need `online_store:read`; saving and templates need
 * `online_store:manage_policies`. Admin answers never carry who last saved (`updatedBy`).
 * ---------------------------------------------------------------------------------------------- */

/** One row of the policy list: whether it is set, in which languages, and when. */
export interface PolicySummaryDto {
  readonly type: PolicyType;
  readonly set: boolean;
  readonly locales: readonly ("ar" | "en")[];
  readonly updatedAt: string | null;
}
/** One policy's text with the version a save must send back. */
export interface PolicyDto {
  readonly type: PolicyType;
  readonly body: LocalizedText;
  readonly updatedAt: string | null;
  readonly version: number;
}
/** What the template generator asks the merchant (`services/online-store` `PolicyTemplateInputs`). */
export interface PolicyTemplateInputsDto {
  readonly storeName: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly businessAddress: string;
  readonly returnWindowDays: number;
  readonly returnShippingPaidBy: "customer" | "store";
  readonly refundMethod: "original" | "store_credit" | "cash";
  readonly cashOnDelivery: boolean;
  readonly deliveryDays: { readonly min: number; readonly max: number };
  readonly shipsInternationally: boolean;
}

const isLocaleList = (v: unknown): v is ("ar" | "en")[] =>
  Array.isArray(v) && v.every((l) => l === "ar" || l === "en");
const isPolicySummary = (v: unknown): v is PolicySummaryDto =>
  isObject(v) &&
  isPolicyType(v["type"]) &&
  typeof v["set"] === "boolean" &&
  isLocaleList(v["locales"]) &&
  isNullableString(v["updatedAt"]);
const isPolicyList = (v: unknown): v is { policies: PolicySummaryDto[] } =>
  isObject(v) && Array.isArray(v["policies"]) && v["policies"].every(isPolicySummary);
/** `{ ar?, en? }` with string values and no other key. */
const isLocalizedBody = (v: unknown): v is LocalizedText =>
  isObject(v) &&
  !Array.isArray(v) &&
  Object.entries(v).every(
    ([key, text]) => (key === "ar" || key === "en") && typeof text === "string",
  );
const isPolicy = (v: unknown): v is PolicyDto =>
  isObject(v) &&
  isPolicyType(v["type"]) &&
  isLocalizedBody(v["body"]) &&
  isNullableString(v["updatedAt"]) &&
  isNumber(v["version"]);
const isTemplateText = (v: unknown): v is { body: string } =>
  isObject(v) && typeof v["body"] === "string";

const policyUrl = (type: PolicyType) => `/api/v1/online-store/policies/${encodeURIComponent(type)}`;

/** `GET /online-store/policies`: the five policies, set or not. */
export async function fetchPolicies(): Promise<ApiResult<readonly PolicySummaryDto[]>> {
  const result = await getAdminApi("/api/v1/online-store/policies", isPolicyList);
  return result.outcome === "ok" ? { outcome: "ok", data: result.data.policies } : result;
}

/** `GET /online-store/policies/:type`: the text in both languages and its version. */
export function fetchPolicy(type: PolicyType): Promise<ApiResult<PolicyDto>> {
  return getAdminApi(policyUrl(type), isPolicy);
}

/** `PUT /online-store/policies/:type`: live on save; an empty text unsets the policy. */
export function updatePolicy(
  type: PolicyType,
  body: { body: LocalizedText; expectedVersion: number },
  idempotencyKey: string,
): Promise<MutationResult<PolicyDto>> {
  return mutateAdminApi(policyUrl(type), { method: "PUT", body, idempotencyKey }, isPolicy);
}

/**
 * `POST /online-store/policies/:type/template`: starting text in one language. NOT idempotent on
 * purpose (like `issuePreviewToken`): it is pure and saves nothing, so there is nothing to replay.
 */
export function generatePolicyTemplate(
  type: PolicyType,
  body: { locale: "ar" | "en"; inputs: PolicyTemplateInputsDto },
): Promise<MutationResult<{ body: string }>> {
  return mutateAdminApi(`${policyUrl(type)}/template`, { method: "POST", body }, isTemplateText);
}
