import { Money } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";
import { DEFAULT_VARIANT_ATTRIBUTES, type VariantAttributes } from "../domain/variant";

/**
 * Plan 2C-1: the optional variant attributes every variant-writing use case accepts. For each
 * field, `undefined` keeps the current value and `null` clears it, so older callers (admin-web
 * sends only sku/price/currency) change nothing they did not name.
 */
export interface VariantAttributesInput {
  readonly compareAtAmountMinor?: number | null;
  readonly costAmountMinor?: number | null;
  readonly barcode?: string | null;
  readonly weightGrams?: number | null;
  readonly requiresShipping?: boolean;
  readonly taxable?: boolean;
}

function moneyOrKeep(
  amountMinor: number | null | undefined,
  currency: string,
  current: Money | null,
  field: string,
): Result<Money | null, ValidationError> {
  if (amountMinor === undefined) return ok(current);
  if (amountMinor === null) return ok(null);
  const money = Money.create(amountMinor, currency);
  return money.ok
    ? ok(money.value)
    : err(
        new ValidationError("Invalid variant", [
          { field, message: "must be a whole, non-negative number of minor units" },
        ]),
      );
}

/** Merges `input` over `base` into domain attributes. Range/currency rules run in `Variant`. */
export function toVariantAttributes(
  input: VariantAttributesInput,
  currency: string,
  base: VariantAttributes = DEFAULT_VARIANT_ATTRIBUTES,
): Result<VariantAttributes, ValidationError> {
  const compareAtPrice = moneyOrKeep(
    input.compareAtAmountMinor,
    currency,
    base.compareAtPrice,
    "compareAtAmountMinor",
  );
  if (!compareAtPrice.ok) return compareAtPrice;
  const cost = moneyOrKeep(input.costAmountMinor, currency, base.cost, "costAmountMinor");
  if (!cost.ok) return cost;
  let barcode = base.barcode;
  if (input.barcode === null) barcode = null;
  else if (input.barcode !== undefined) {
    const trimmed = input.barcode.trim();
    barcode = trimmed.length === 0 ? null : trimmed;
  }
  return ok({
    compareAtPrice: compareAtPrice.value,
    cost: cost.value,
    barcode,
    weightGrams: input.weightGrams === undefined ? base.weightGrams : input.weightGrams,
    requiresShipping: input.requiresShipping ?? base.requiresShipping,
    taxable: input.taxable ?? base.taxable,
  });
}
