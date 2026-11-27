import {
  AD_PLATFORM_ORDER,
  isAdPlatformKey,
  type AdPlatformKey,
  type ConnectionViewDto,
  type PublicConfigDto,
} from "@/lib/ad-platforms-model";
import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * Lead site D1 - Settings > Ad platforms. Server-only calls to the committed routes
 * (`apps/admin/src/http/ad-platforms-routes.ts`). Client components take the shapes from
 * `lib/ad-platforms-model.ts` (pure data), never from here; the types and the order are re-exported
 * so this file stays the one place a server caller looks.
 */
export { AD_PLATFORM_ORDER };
export type { AdPlatformKey, ConnectionViewDto };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isPublicConfig(value: unknown, platform: AdPlatformKey): value is PublicConfigDto {
  if (!isRecord(value) || value["platform"] !== platform) return false;
  switch (platform) {
    case "meta":
    case "snap":
      return typeof value["pixelId"] === "string";
    case "tiktok":
      return typeof value["pixelCode"] === "string";
    case "ga4":
      return typeof value["measurementId"] === "string";
    case "google_ads": {
      const labels = value["labels"];
      return (
        typeof value["conversionId"] === "string" &&
        isRecord(labels) &&
        isOptionalString(labels["lead"]) &&
        isOptionalString(labels["contact"]) &&
        isOptionalString(labels["purchase"])
      );
    }
  }
}

function isConnectionView(value: unknown): value is ConnectionViewDto {
  if (!isRecord(value) || !isAdPlatformKey(value["platform"])) return false;
  const secret = value["secret"];
  return (
    typeof value["enabled"] === "boolean" &&
    (value["publicConfig"] === null || isPublicConfig(value["publicConfig"], value["platform"])) &&
    isRecord(secret) &&
    typeof secret["configured"] === "boolean" &&
    (secret["last4"] === null || typeof secret["last4"] === "string") &&
    (value["testEventCode"] === null || typeof value["testEventCode"] === "string") &&
    typeof value["complete"] === "boolean" &&
    typeof value["live"] === "boolean" &&
    typeof value["version"] === "number" &&
    Number.isInteger(value["version"]) &&
    value["version"] >= 0
  );
}

/** Exactly the five platforms, once each: anything else is not the contract. */
function isConnectionList(
  value: unknown,
): value is { readonly items: readonly ConnectionViewDto[] } {
  if (!isRecord(value) || !Array.isArray(value["items"])) return false;
  const items: readonly unknown[] = value["items"];
  if (!items.every(isConnectionView)) return false;
  const seen = new Set(items.map((item) => item.platform));
  return items.length === AD_PLATFORM_ORDER.length && seen.size === AD_PLATFORM_ORDER.length;
}

export type FetchAdPlatformsResult =
  | { readonly outcome: "ok"; readonly items: readonly ConnectionViewDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /ad-platforms`: the five connections in the platform order (never a token). */
export async function fetchAdPlatforms(): Promise<FetchAdPlatformsResult> {
  const result = await getAdminApi("/api/v1/ad-platforms", isConnectionList);
  if (result.outcome === "ok") {
    const byKey = new Map(result.data.items.map((item) => [item.platform, item]));
    return {
      outcome: "ok",
      items: AD_PLATFORM_ORDER.map((key) => byKey.get(key)).filter(
        (item): item is ConnectionViewDto => item !== undefined,
      ),
    };
  }
  if (result.outcome === "error") return { outcome: "error", message: result.message };
  return result;
}

export interface SaveAdPlatformInput {
  readonly enabled: boolean;
  /** The ids without `platform` (the path names it); null while there are none (only valid when off). */
  readonly publicConfig: Readonly<Record<string, unknown>> | null;
  /** Write-only. Absent or "" keeps the saved token: neither is ever sent. */
  readonly secret?: string | undefined;
  /** True removes the saved token. */
  readonly clearSecret?: boolean | undefined;
  /** Meta and TikTok only: undefined keeps the saved code, null (or "") removes it. */
  readonly testEventCode?: string | null | undefined;
  /** The version the card loaded; 0 while the shop has no row for the platform yet. */
  readonly expectedVersion: number;
}

/**
 * `PUT /ad-platforms/:platform`: saves one platform. The route's body is strict, so exactly these
 * fields are sent - and `secret` only when it has text, `clearSecret` only when true.
 */
export function saveAdPlatform(
  platform: AdPlatformKey,
  input: SaveAdPlatformInput,
  idempotencyKey: string,
): Promise<MutationResult<ConnectionViewDto>> {
  const hasSecret = typeof input.secret === "string" && input.secret !== "";
  return mutateAdminApi(
    `/api/v1/ad-platforms/${encodeURIComponent(platform)}`,
    {
      method: "PUT",
      body: {
        enabled: input.enabled,
        publicConfig: input.publicConfig,
        ...(hasSecret ? { secret: input.secret } : {}),
        ...(input.clearSecret === true ? { clearSecret: true } : {}),
        ...(input.testEventCode === undefined ? {} : { testEventCode: input.testEventCode }),
        expectedVersion: input.expectedVersion,
      },
      idempotencyKey,
    },
    isConnectionView,
  );
}
