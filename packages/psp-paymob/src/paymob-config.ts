import { isPaymobRegion, type PaymobRegion } from "./paymob-payment-provider";

/** A merchant's Paymob routing data: not secret, so it is stored in the clear next to the sealed credentials. */
export interface PaymobConfig {
  readonly region: PaymobRegion;
  readonly integrationId: number;
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
  const { region, integrationId } = raw as { region?: unknown; integrationId?: unknown };
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
  return { ok: true, value: { region, integrationId } };
}
