import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";
import type { RateConditionDto, ZoneCountryDto, ZoneDto } from "@/lib/shipping/zones";

export type { RateConditionDto, RateDto, ZoneCountryDto, ZoneDto } from "@/lib/shipping/zones";

interface ZonesResponse {
  readonly items: readonly ZoneDto[];
}

function isZonesResponse(value: unknown): value is ZonesResponse {
  if (typeof value !== "object" || value === null) return false;
  const items = (value as { items?: unknown }).items;
  return (
    Array.isArray(items) &&
    items.every((item: unknown) => {
      if (typeof item !== "object" || item === null) return false;
      const zone = item as Record<string, unknown>;
      return (
        typeof zone["id"] === "string" &&
        typeof zone["name"] === "string" &&
        Array.isArray(zone["countries"]) &&
        Array.isArray(zone["rates"])
      );
    })
  );
}

export type FetchShippingZonesResult =
  | { readonly outcome: "ok"; readonly zones: readonly ZoneDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /shipping/zones` — the shop's shipping zones with their rates. */
export async function fetchShippingZones(): Promise<FetchShippingZonesResult> {
  const result = await getAdminApi("/api/v1/shipping/zones", isZonesResponse);
  if (result.outcome === "ok") return { outcome: "ok", zones: result.data.items };
  return result;
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

export interface RateInputDto {
  readonly name: string;
  readonly priceMinor: number;
  readonly condition: RateConditionDto;
  readonly description: string | null;
}

export function createShippingZone(
  input: {
    readonly name: string;
    readonly countries: readonly ZoneCountryDto[];
    /** Plan 3E: saved with the zone in one call, all or nothing. */
    readonly rates?: readonly RateInputDto[];
  },
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/shipping/zones",
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

export function updateShippingZone(
  zoneId: string,
  input: { readonly name: string; readonly countries: readonly ZoneCountryDto[] },
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/shipping/zones/${encodeURIComponent(zoneId)}`,
    { method: "PUT", body: input, idempotencyKey },
    isUnknown,
  );
}

export function deleteShippingZone(
  zoneId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/shipping/zones/${encodeURIComponent(zoneId)}`,
    { method: "DELETE", idempotencyKey },
    isUnknown,
  );
}

export function addShippingRate(
  zoneId: string,
  input: RateInputDto,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/shipping/zones/${encodeURIComponent(zoneId)}/rates`,
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

export function updateShippingRate(
  zoneId: string,
  rateId: string,
  input: RateInputDto,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/shipping/zones/${encodeURIComponent(zoneId)}/rates/${encodeURIComponent(rateId)}`,
    { method: "PUT", body: input, idempotencyKey },
    isUnknown,
  );
}

export function deleteShippingRate(
  zoneId: string,
  rateId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/shipping/zones/${encodeURIComponent(zoneId)}/rates/${encodeURIComponent(rateId)}`,
    { method: "DELETE", idempotencyKey },
    isUnknown,
  );
}
