"use client";

import { useId, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import type { ProductVariantDto } from "@/lib/api/products";
import type { StockView } from "@/lib/products/stock";
import type { Dictionary } from "@/messages/en";
import { Chip, ChipPanel, ChipRow, Switch } from "./controls";
import { Field, PRODUCT_FORM_ID } from "./field";

/**
 * The part of the inventory block that follows the "Inventory tracked" switch: an optional
 * quantity table (only the page's card has one), then chips for SKU, barcode and "sell when out of
 * stock". The switch itself lives with the caller, because the card puts it in its header and the
 * variant dialog puts it on a row of its own.
 *
 * Turning tracking off hides the quantity table and the sell chip instead of unmounting them, so a
 * typed number survives the toggle (the same approach the shipping card takes for the weight).
 */
export function InventoryBody({
  tracked,
  variant,
  quantityTable,
  mode,
  errors,
  t,
  form,
}: {
  readonly tracked: boolean;
  /** `undefined` while creating: there is no variant yet. */
  readonly variant: ProductVariantDto | undefined;
  readonly quantityTable?: ReactNode;
  readonly mode: "create" | "edit";
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
  readonly form: string | undefined;
}) {
  const editor = t.productEditor;
  const base = useId();
  const [sku, setSku] = useState(variant?.sku ?? "");
  const [barcode, setBarcode] = useState(variant?.barcode ?? "");
  const [continueSelling, setContinueSelling] = useState(variant?.inventoryPolicy === "continue");
  const [open, setOpen] = useState(() => ({
    sku: (variant?.sku ?? "") !== "",
    barcode: (variant?.barcode ?? "") !== "",
    sell: variant?.inventoryPolicy === "continue",
  }));
  const toggle = (key: keyof typeof open) =>
    setOpen((current) => ({ ...current, [key]: !current[key] }));
  // A field the server rejected opens its chip, so the message is never behind a closed one.
  const skuOpen = open.sku || errors["sku"] !== undefined;
  const barcodeOpen = open.barcode || errors["barcode"] !== undefined;

  return (
    <div className="flex flex-col gap-4">
      {quantityTable !== undefined && (
        <div hidden={!tracked} className="flex flex-col gap-2">
          {quantityTable}
        </div>
      )}

      <ChipRow>
        <Chip
          label={editor.sku}
          value={sku.trim() === "" ? "—" : sku}
          expanded={skuOpen}
          onToggle={() => toggle("sku")}
          controls={`${base}-sku`}
        />
        <Chip
          label={editor.barcode}
          value={barcode.trim() === "" ? undefined : barcode}
          expanded={barcodeOpen}
          onToggle={() => toggle("barcode")}
          controls={`${base}-barcode`}
        />
        <span hidden={!tracked} className="contents">
          <Chip
            label={editor.sellWhenOutOfStock}
            value={continueSelling ? editor.on : editor.off}
            expanded={open.sell}
            onToggle={() => toggle("sell")}
            controls={`${base}-sell`}
          />
        </span>
      </ChipRow>

      <ChipPanel id={`${base}-sku`} open={skuOpen}>
        <Field label={editor.sku} name="sku" error={errors["sku"]} form={form}>
          {(control) => (
            <Input
              {...control}
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              placeholder={mode === "create" ? editor.skuAuto : undefined}
            />
          )}
        </Field>
      </ChipPanel>
      <ChipPanel id={`${base}-barcode`} open={barcodeOpen}>
        <Field label={editor.barcode} name="barcode" error={errors["barcode"]} form={form}>
          {(control) => (
            <Input
              {...control}
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
            />
          )}
        </Field>
      </ChipPanel>
      <ChipPanel id={`${base}-sell`} open={open.sell && tracked}>
        <Switch
          name="continueSelling"
          form={form}
          label={editor.sellWhenOutOfStock}
          checked={continueSelling}
          onCheckedChange={setContinueSelling}
        />
      </ChipPanel>
    </div>
  );
}

/**
 * Plan 2B-2 / 2C-4 — the single-variant Inventory card, as in Shopify: the "Inventory tracked"
 * switch in the header, a quantity table with one row per location, and chips for SKU, barcode
 * and "sell when out of stock". Stock quantities are edited as AVAILABLE; the page's Save turns
 * that into a receive or an adjust.
 */
export function InventoryCard({
  variant,
  stock,
  t,
  errors,
  mode,
}: {
  /** `undefined` while creating: there is no variant and no stock yet. */
  readonly variant: ProductVariantDto | undefined;
  readonly stock: StockView;
  readonly t: Dictionary;
  readonly errors: Readonly<Record<string, string>>;
  readonly mode: "create" | "edit";
}) {
  const editor = t.productEditor;
  const headingId = useId();
  // One row per active location (Plan 2B-3); a shop with none yet shows the one row the first save
  // will register, posted as the lone `available`.
  const rows: readonly { readonly id: string | null; readonly name: string }[] =
    stock.locations.length > 0 ? stock.locations : [{ id: null, name: editor.shopLocation }];
  const levelAt = (locationId: string | null) =>
    variant === undefined || locationId === null
      ? undefined
      : stock.byLocation[locationId]?.[variant.id];
  // Controlled, so a failed Save does not reset what was typed (React 19 resets uncontrolled
  // inputs when a form action finishes). Keyed by location so each keeps its own number.
  const [tracked, setTracked] = useState(variant?.tracksInventory ?? true);
  const [quantities, setQuantities] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      rows.map((row) => {
        const level = levelAt(row.id);
        return [row.id ?? "", level === undefined ? "" : String(level.available)];
      }),
    ),
  );
  const readOnly = stock.readOnlyReason !== null;

  const quantityTable = (
    <>
      <div className="border-border overflow-hidden rounded-lg border">
        <div className="bg-muted text-muted-foreground grid grid-cols-[1fr_10rem] gap-3 px-3 py-2 text-xs font-medium">
          <span aria-hidden="true" />
          <span id={headingId} className="sm:text-end">
            {editor.quantity}
          </span>
        </div>
        {rows.map((row) => {
          const fieldName = row.id === null ? "available" : `available-${row.id}`;
          const error = errors[fieldName];
          const errorId = `${headingId}-${row.id ?? "shop"}-error`;
          return (
            <div
              key={row.id ?? "shop"}
              className="grid grid-cols-[1fr_10rem] items-center gap-3 px-3 py-2"
            >
              <span className="text-sm font-medium">{row.name}</span>
              {readOnly ? (
                <span className="text-sm sm:text-end">—</span>
              ) : (
                <div className="flex flex-col gap-1">
                  <Input
                    name={fieldName}
                    form={PRODUCT_FORM_ID}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    aria-label={row.id !== null ? `${editor.quantity}: ${row.name}` : undefined}
                    aria-labelledby={row.id === null ? headingId : undefined}
                    aria-invalid={error !== undefined ? true : undefined}
                    aria-describedby={error !== undefined ? errorId : undefined}
                    value={quantities[row.id ?? ""] ?? ""}
                    onChange={(event) => {
                      const next = event.target.value;
                      setQuantities((current) => ({ ...current, [row.id ?? ""]: next }));
                    }}
                  />
                  {error !== undefined && (
                    <p id={errorId} className="text-destructive text-xs">
                      {error}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {stock.readOnlyReason !== null && (
        <p role="note" className="text-muted-foreground text-xs">
          {editor.stockUnavailable}
        </p>
      )}
    </>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editor.inventoryCard}</CardTitle>
        <Switch
          name="tracksInventory"
          form={PRODUCT_FORM_ID}
          label={editor.inventoryTracked}
          checked={tracked}
          onCheckedChange={setTracked}
        />
      </CardHeader>
      <CardContent>
        <InventoryBody
          tracked={tracked}
          variant={variant}
          quantityTable={quantityTable}
          mode={mode}
          errors={errors}
          t={t}
          form={PRODUCT_FORM_ID}
        />
      </CardContent>
    </Card>
  );
}
