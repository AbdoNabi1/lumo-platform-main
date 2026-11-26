import { ValidationError } from "@platform/domain";

/**
 * Wave 2a: the shop's add-to-cart limit - the most of ONE line a cart may hold. Checkout owns the
 * setting; the caller passes the limit in (`maxLineQuantity`), so Cart never reads another
 * context. The wording is the one the storefront shows the shopper.
 */
export function cartLineLimitMessage(limit: number): string {
  return `You can add up to ${limit} of this item`;
}

/** A 422 on `quantity` when `resulting` is over `limit`; null when there is no limit or it fits. */
export function lineLimitError(
  limit: number | null | undefined,
  resulting: number,
): ValidationError | null {
  if (limit === null || limit === undefined || resulting <= limit) return null;
  return new ValidationError("Cart limit exceeded", [
    { field: "quantity", message: cartLineLimitMessage(limit) },
  ]);
}
