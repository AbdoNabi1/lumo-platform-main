import { isPaymobRegion, type PaymobRegion } from "./paymob-payment-provider";

/** A merchant's Paymob routing data: not secret, so it is stored in the clear next to the sealed credentials. */
export interface PaymobConfig {
  readonly region: PaymobRegion;
  readonly integrationId: number;
  /** The MOTO integration id merchant-initiated charges use; absent until Paymob enables one. */
  readonly motoIntegrationId?: number;
}

export type ParsePaymobConfigResult =
  | { readonly ok: true; readonly value: PaymobConfig }
  | { readonly ok: false; readonly reason: string };

/**
 * Validates Paymob's own per-merchant, non-secret configuration. This package — not the payments
 * domain — owns what a valid Paymob region and integration id are, so the registry's config check
 * and the adapter's `isPaymobRegion` can never drift apart. Returns exactly the two fields, dropping
 * anything else the caller sent.
 */
export function parsePaymobConfig(raw: unknown): ParsePaymobConfigResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "expected an object with region and integrationId" };
  }
  const { region, integrationId, motoIntegrationId } = raw as {
    region?: unknown;
    integrationId?: unknown;
    motoIntegrationId?: unknown;
  };
  if (typeof region !== "string" || !isPaymobRegion(region)) {
    return { ok: false, reason: "unsupported Paymob region" };
  }
  if (
    typeof integrationId !== "number" ||
    !Number.isSafeInteger(integrationId) ||
    integrationId <= 0
  ) {
    return { ok: false, reason: "integrationId must be a positive integer" };
  }
  if (motoIntegrationId === undefined) return { ok: true, value: { region, integrationId } };
  if (
    typeof motoIntegrationId !== "number" ||
    !Number.isSafeInteger(motoIntegrationId) ||
    motoIntegrationId <= 0
  ) {
    return { ok: false, reason: "motoIntegrationId must be a positive integer" };
  }
  return { ok: true, value: { region, integrationId, motoIntegrationId } };
}
