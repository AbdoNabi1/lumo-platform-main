"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import type { ProductVariantDto } from "@/lib/api/products";
import type { StockView } from "@/lib/products/stock";
import type { Dictionary } from "@/messages/en";
import { CheckboxRow, Field, PRODUCT_FORM_ID } from "./field";

/**
 * Plan 2B-2 — the single-variant Inventory card, as in Shopify: "Track quantity", the quantity
 * next to the location's name, "Continue selling when out of stock", then SKU and barcode.
 * Stock quantities are edited as AVAILABLE; the page's Save turns that into a receive or an adjust.
 *
 * Turning tracking off hides the quantity row instead of unmounting it, so a typed number survives
 * the toggle (the same approach the shipping card takes for the weight).
 */
export function InventoryCard({
  variant,
  stock,
  t,
  errors,
  mode,
}: {
  /** `undefined` while creating: there is no variant, no stock and no location yet. */
  readonly variant: ProductVariantDto | undefined;
  readonly stock: StockView;
  readonly t: Dictionary;
  readonly errors: Readonly<Record<string, string>>;
  readonly mode: "create" | "edit";
}) {
  const editor = t.productEditor;
  const level = variant === undefined ? undefined : stock.byVariant[variant.id];
  // Controlled, so a failed Save does not reset what was typed (React 19 resets uncontrolled
  // inputs when a form action finishes).
  const [tracked, setTracked] = useState(variant?.tracksInventory ?? true);
  const [quantity, setQuantity] = useState(level === undefined ? "" : String(level.available));
  const [continueSelling, setContinueSelling] = useState(variant?.inventoryPolicy === "continue");
  const readOnly = stock.multipleLocations || stock.readOnlyReason !== null;
  const locationName = stock.location?.name ?? editor.shopLocation;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editor.inventoryCard}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CheckboxRow
          name="tracksInventory"
          form={PRODUCT_FORM_ID}
          label={editor.trackQuantity}
          checked={tracked}
          onChange={(event) => setTracked(event.target.checked)}
        />

        <div hidden={!tracked} className="flex flex-col gap-4">
          <div className="grid items-end gap-4 sm:grid-cols-[1fr_10rem]">
            <span className="text-sm font-medium">{locationName}</span>
            {readOnly ? (
              <span className="text-sm sm:text-end">
                {stock.readOnlyReason === null ? (level?.available ?? 0) : "—"}
              </span>
            ) : (
              <Field
                label={editor.quantity}
                name="available"
                error={errors["available"]}
                form={PRODUCT_FORM_ID}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                )}
              </Field>
            )}
          </div>
          {stock.multipleLocations && (
            <p className="text-muted-foreground text-xs">{editor.multipleLocations}</p>
          )}
          {stock.readOnlyReason !== null && (
            <p role="note" className="text-muted-foreground text-xs">
              {editor.stockUnavailable}
            </p>
          )}

          <CheckboxRow
            name="continueSelling"
            form={PRODUCT_FORM_ID}
            label={editor.continueSelling}
            checked={continueSelling}
            onChange={(event) => setContinueSelling(event.target.checked)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={editor.sku} name="sku" error={errors["sku"]} form={PRODUCT_FORM_ID}>
            {(control) => (
              <Input
                {...control}
                defaultValue={variant?.sku ?? ""}
                placeholder={mode === "create" ? editor.skuAuto : undefined}
              />
            )}
          </Field>
          <Field
            label={editor.barcode}
            name="barcode"
            error={errors["barcode"]}
            form={PRODUCT_FORM_ID}
          >
            {(control) => <Input {...control} defaultValue={variant?.barcode ?? ""} />}
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}
