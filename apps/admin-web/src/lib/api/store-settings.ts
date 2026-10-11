import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

export type WeightUnit = "kg" | "g" | "lb" | "oz";

/** `GET /store/settings` — Shopify's Settings → General for the shop. */
export interface StoreSettingsDto {
  readonly storeName: string;
  readonly contactEmail: string | null;
  /** The store currency (ISO 4217): every price is in it. */
  readonly currency: string;
  readonly timezone: string;
  readonly weightUnit: WeightUnit;
}

const WEIGHT_UNITS: readonly string[] = ["kg", "g", "lb", "oz"];

function isStoreSettingsDto(value: unknown): value is StoreSettingsDto {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["storeName"] === "string" &&
    (candidate["contactEmail"] === null || typeof candidate["contactEmail"] === "string") &&
    typeof candidate["currency"] === "string" &&
    typeof candidate["timezone"] === "string" &&
    typeof candidate["weightUnit"] === "string" &&
    WEIGHT_UNITS.includes(candidate["weightUnit"])
  );
}

export type FetchStoreSettingsResult =
  | { readonly outcome: "ok"; readonly settings: StoreSettingsDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

export async function fetchStoreSettings(): Promise<FetchStoreSettingsResult> {
  const result = await getAdminApi("/api/v1/store/settings", isStoreSettingsDto);
  if (result.outcome === "ok") return { outcome: "ok", settings: result.data };
  return result;
}

/** Replaces the shop's settings. A new currency relabels every price, keeping the numbers. */
export function updateStoreSettings(
  settings: StoreSettingsDto,
  idempotencyKey: string,
): Promise<MutationResult<StoreSettingsDto>> {
  return mutateAdminApi(
    "/api/v1/store/settings",
    { method: "PUT", body: settings, idempotencyKey },
    isStoreSettingsDto,
  );
}

/** What the API answers before a first save. */
export const DEFAULT_STORE_SETTINGS: StoreSettingsDto = {
  storeName: "",
  contactEmail: null,
  currency: "EGP",
  timezone: "Africa/Cairo",
  weightUnit: "kg",
};

/** The settings, or the defaults when they cannot be read (the product editor must still open). */
export async function storeSettingsOrDefaults(): Promise<StoreSettingsDto> {
  const result = await fetchStoreSettings();
  return result.outcome === "ok" ? result.settings : DEFAULT_STORE_SETTINGS;
}
