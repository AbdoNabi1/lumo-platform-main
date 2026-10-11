import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

export interface ProvinceRateDto {
  /** ISO 3166-2, for example `EG-C`. */
  readonly code: string;
  readonly rateBasisPoints: number;
}

export interface TaxRegionDto {
  readonly countryCode: string;
  readonly rateBasisPoints: number;
  readonly provinces: readonly ProvinceRateDto[];
}

/** `GET /taxes` — Shopify's Taxes and duties for the shop. */
export interface TaxSettingsDto {
  readonly pricesIncludeTax: boolean;
  readonly chargeTaxOnShipping: boolean;
  readonly regions: readonly TaxRegionDto[];
}

function isTaxSettingsDto(value: unknown): value is TaxSettingsDto {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["pricesIncludeTax"] === "boolean" &&
    typeof candidate["chargeTaxOnShipping"] === "boolean" &&
    Array.isArray(candidate["regions"]) &&
    candidate["regions"].every((region: unknown) => {
      const r = region as Record<string, unknown> | null;
      return (
        typeof r?.["countryCode"] === "string" &&
        typeof r["rateBasisPoints"] === "number" &&
        Array.isArray(r["provinces"])
      );
    })
  );
}

export type FetchTaxSettingsResult =
  | { readonly outcome: "ok"; readonly settings: TaxSettingsDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

export async function fetchTaxSettings(): Promise<FetchTaxSettingsResult> {
  const result = await getAdminApi("/api/v1/taxes", isTaxSettingsDto);
  if (result.outcome === "ok") return { outcome: "ok", settings: result.data };
  return result;
}

/** Saves "All prices include tax" and "Charge tax on shipping rates". */
export function updateTaxFlags(
  flags: { readonly pricesIncludeTax: boolean; readonly chargeTaxOnShipping: boolean },
  idempotencyKey: string,
): Promise<MutationResult<TaxSettingsDto>> {
  return mutateAdminApi(
    "/api/v1/taxes/settings",
    { method: "PUT", body: flags, idempotencyKey },
    isTaxSettingsDto,
  );
}

/** Adds or replaces a country's region. Rates are basis points (1400 = 14%). */
export function upsertTaxRegion(
  countryCode: string,
  region: { readonly rateBasisPoints: number; readonly provinces: readonly ProvinceRateDto[] },
  idempotencyKey: string,
): Promise<MutationResult<TaxSettingsDto>> {
  return mutateAdminApi(
    `/api/v1/taxes/regions/${encodeURIComponent(countryCode)}`,
    { method: "PUT", body: region, idempotencyKey },
    isTaxSettingsDto,
  );
}

export function deleteTaxRegion(
  countryCode: string,
  idempotencyKey: string,
): Promise<MutationResult<TaxSettingsDto>> {
  return mutateAdminApi(
    `/api/v1/taxes/regions/${encodeURIComponent(countryCode)}`,
    { method: "DELETE", idempotencyKey },
    isTaxSettingsDto,
  );
}
