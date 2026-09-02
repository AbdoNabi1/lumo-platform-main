import type { Price } from "@platform/pricing";
import { ValidationError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { PageResponse } from "./public-catalog-routes";

/**
 * Server-side price resolution shared by every Cart-mutating HTTP route that used to accept a
 * caller-supplied `unitPriceAmountMinor`/`currency` (Phase 17.1 H-01 on the public surface, Phase
 * 17.2 on the admin-authenticated surface — same defect, same fix, now written once). Extracted
 * from `public-cart-routes.ts` rather than duplicated a second time in `cart-routes.ts`.
 */
export type PriceResolution =
  | { readonly status: "ok"; readonly amountMinor: number; readonly currency: string }
  | { readonly status: "unavailable" }
  /** More than one row is `"published"` for the same product — same real backend gap `PriceBook.resolve()` already surfaces in the storefront (Pricing has no invariant preventing concurrently-published prices). */
  | { readonly status: "ambiguous" }
  | { readonly status: "error" };

/**
 * Resolves `productId`'s authoritative price server-side from Pricing's own published-price data
 * (H-01 remediation) — no caller, public or admin-authenticated, may choose the price a cart line
 * is added at. `ListPrices` (Pricing's only list use case) has no product filter, so this pages the
 * same `first: 100` ceiling the storefront's own `PriceBook.load()` already accepts as a disclosed
 * limitation (`apps/storefront/src/lib/catalog.ts`) — not a new one introduced here. Resolution
 * semantics mirror `PriceBook.resolve()` exactly: zero published rows for the product is
 * `"unavailable"`, more than one is `"ambiguous"` (never guessed at), exactly one is `"ok"`.
 */
export async function resolvePrice(admin: WiredAdmin, productId: string): Promise<PriceResolution> {
  const response = await admin.publicReads.prices.list({ first: 100 });
  if (response.status < 200 || response.status >= 300) return { status: "error" };
  const { items } = response.body as { items: readonly Price[] };
  const matches = items.filter(
    (price) => price.status === "published" && price.product.value === productId,
  );
  if (matches.length === 0) return { status: "unavailable" };
  if (matches.length > 1) return { status: "ambiguous" };
  const [price] = matches;
  if (price === undefined) return { status: "unavailable" };
  return { status: "ok", amountMinor: price.amount.amountMinor, currency: price.amount.currency };
}

/** The response for every non-`"ok"` {@link PriceResolution} — never leaks which specific reason (unavailable vs. ambiguous vs. a downstream Pricing failure) to the caller. */
export function priceUnresolvedResponse(): PageResponse {
  return {
    status: 422,
    body: toErrorEnvelope(new ValidationError("Unable to resolve a price for this product")),
  };
}
