"use client";

import { useId, useState } from "react";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { ProductSummary } from "@/lib/runtime-api";
import type { Dictionary } from "@/messages/en";

/**
 * Plan 2A — the shopper buys a specific variant (a size, a colour), not "the product". One
 * `<select>` per declared option, each starting on its first value; the chosen combination resolves
 * to the variant whose `selection` matches every choice, and THAT variant's price is the one shown
 * (the server prices the cart line from the same variant — this price is a display, never an input).
 *
 * A combination with no variant (an option matrix with holes) shows {@link Dictionary} copy instead
 * of a price and leaves add-to-cart disabled. A product with no options (a single variant) renders
 * just its price and the button, wired to that one variant's id.
 */
export function VariantPicker({
  product,
  outOfStock,
  t,
  locale,
}: {
  readonly product: ProductSummary;
  readonly outOfStock: boolean;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const idPrefix = useId();
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(product.options.map((option) => [option.name, option.values[0] ?? ""])),
  );

  const variant =
    product.options.length === 0
      ? product.variants[0]
      : product.variants.find((candidate) =>
          product.options.every(
            (option) => candidate.selection?.[option.name] === chosen[option.name],
          ),
        );

  return (
    <div className="flex flex-col gap-3">
      {product.options.map((option, index) => {
        const id = `${idPrefix}-${index}`;
        return (
          <div key={option.name} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm font-medium">
              {t.product.chooseOption.replace("{option}", option.name)}
            </label>
            <select
              id={id}
              value={chosen[option.name]}
              onChange={(event) => setChosen({ ...chosen, [option.name]: event.target.value })}
              className="border-border bg-background rounded-md border px-3 py-2 text-sm"
            >
              {option.values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        );
      })}

      {variant !== undefined ? (
        <p className="text-lg font-semibold">
          {formatCurrency(locale, variant.priceAmountMinor, variant.currency)}
        </p>
      ) : (
        <p role="status" className="text-destructive text-sm">
          {t.product.unavailableCombination}
        </p>
      )}

      <AddToCartButton
        productId={product.id}
        variantId={variant?.id}
        outOfStock={outOfStock || variant === undefined}
        t={t}
      />
    </div>
  );
}
