"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { removeProductVariantAction, updateVariantDetailsAction } from "@/app/products/actions";
import type { FormState } from "@/lib/api/mutation";
import type { ProductDetailDto, ProductVariantDto } from "@/lib/api/products";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { fromMinorUnits } from "@/lib/products/money";
import type { StockView } from "@/lib/products/stock";
import { planOptionChange, rowKey, type MatrixOption } from "@/lib/products/variant-matrix";
import type { Dictionary } from "@/messages/en";
import { Switch } from "./controls";
import { PRODUCT_FORM_ID } from "./field";
import { InventoryBody } from "./inventory-card";
import { OptionsEditor } from "./options-editor";
import { PricingFields } from "./pricing-card";
import { ShippingBody } from "./shipping-card";

const INITIAL_STATE: FormState = { status: "idle" };
const NO_ERRORS: Readonly<Record<string, string>> = {};

/** "Red / L" — the variant's values in option order, or "Default" for a plain variant. */
function variantTitle(
  product: ProductDetailDto,
  variant: ProductVariantDto,
  t: Dictionary,
): string {
  if (variant.selection === null) return t.productEditor.defaultVariant;
  const parts = product.options
    .map((option) => variant.selection?.[option.name])
    .filter((value): value is string => value !== undefined);
  return parts.length > 0 ? parts.join(" / ") : t.productEditor.defaultVariant;
}

/**
 * Plan 2B-2 — options and variants, as in Shopify. The options editor and the table both join the
 * page form, so the page's one Save carries them. The table is derived live with the same
 * `planOptionChange` the server action runs: one row per resulting variant, in combination order.
 * Each row posts a hidden key, so the server can refuse a page that no longer matches the product.
 * A dialog edits the rarely used fields of an existing variant.
 */
export function VariantsCard({
  product,
  stock,
  t,
  locale,
  onPlanChange,
  onOptionCountChange,
  errors = NO_ERRORS,
}: {
  readonly product: ProductDetailDto;
  readonly stock: StockView;
  readonly t: Dictionary;
  readonly locale: Locale;
  /** The pending adds and removes, so the page can confirm removals on Save. */
  readonly onPlanChange: (summary: { adds: number; removes: number }) => void;
  /** How many complete options are typed, so the page can hide the single variant's cards. */
  readonly onOptionCountChange?: (count: number) => void;
  readonly errors?: Readonly<Record<string, string>>;
}) {
  const editor = t.productEditor;
  const [typed, setTyped] = useState<MatrixOption[]>(() =>
    product.options.map((option) => ({ name: option.name, values: [...option.values] })),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  // Typed prices and quantities, by row key. Controlled, so a failed Save does not reset them
  // (React 19 resets uncontrolled inputs when a form action finishes), and a value typed in
  // "Size=S" stays with it while other rows come and go.
  const [edits, setEdits] = useState<
    Readonly<Record<string, { price?: string; available?: string }>>
  >({});
  function edit(key: string, patch: { price?: string; available?: string }): void {
    setEdits((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }
  const editing = product.variants.find((variant) => variant.id === editingId);

  // An option still being filled in (no name or no value yet) is not part of the table.
  const options = useMemo(
    () => typed.filter((option) => option.name.trim().length > 0 && option.values.length > 0),
    [typed],
  );
  const complete = options.length === typed.length;
  const plan = useMemo(
    () =>
      planOptionChange({
        productSku: product.sku,
        variants: product.variants,
        nextOptions: options,
      }),
    [product.sku, product.variants, options],
  );

  useEffect(() => {
    onPlanChange(plan.ok ? plan.summary : { adds: 0, removes: 0 });
  }, [plan, onPlanChange]);
  useEffect(() => {
    onOptionCountChange?.(options.length);
  }, [options.length, onOptionCountChange]);

  const first = product.variants[0];
  const readOnly = stock.multipleLocations || stock.readOnlyReason !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editor.variantsCard}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <input type="hidden" name="optionsPresent" value="1" form={PRODUCT_FORM_ID} />
        <OptionsEditor initial={product.options} onChange={setTyped} t={t} />

        {!plan.ok && complete && (
          <p role="note" className="text-destructive text-sm">
            {plan.reason === "too_many_variants" ? editor.tooManyVariants : editor.invalidOptions}
          </p>
        )}

        {plan.ok && options.length > 0 && first !== undefined && (
          <>
            <Table aria-label={editor.variantsCard}>
              <TableHeader>
                <TableRow>
                  <TableHead>{editor.variant}</TableHead>
                  <TableHead>{editor.price}</TableHead>
                  <TableHead>{editor.available}</TableHead>
                  <TableHead className="text-end">
                    <span className="sr-only">{editor.editVariant}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.rows.map((row, index) => {
                  const existing =
                    row.variantId === null
                      ? undefined
                      : product.variants.find((variant) => variant.id === row.variantId);
                  // A new row starts at the first variant's price, as the server will create it.
                  const source = existing ?? first;
                  const title = options
                    .map((option) => row.selection?.[option.name] ?? "")
                    .join(" / ");
                  const level = existing === undefined ? undefined : stock.byVariant[existing.id];
                  const key = rowKey(row.selection);
                  const typedRow = edits[key];
                  const priceError = errors[`row-${index}-price`];
                  const availableError = errors[`row-${index}-available`];
                  return (
                    <TableRow key={key}>
                      <TableCell>
                        <input
                          type="hidden"
                          name={`row-${index}-key`}
                          value={key}
                          form={PRODUCT_FORM_ID}
                        />
                        <span className="flex flex-wrap items-center gap-2">
                          {title}
                          {existing === undefined && (
                            <Badge variant="accent">{editor.newVariant}</Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Input
                          name={`row-${index}-price`}
                          form={PRODUCT_FORM_ID}
                          inputMode="decimal"
                          aria-label={`${editor.price}: ${title}`}
                          aria-invalid={priceError !== undefined ? true : undefined}
                          value={
                            typedRow?.price ??
                            fromMinorUnits(source.priceAmountMinor, source.currency)
                          }
                          onChange={(event) => edit(key, { price: event.target.value })}
                        />
                        {priceError !== undefined && (
                          <p className="text-destructive mt-1 text-xs">{priceError}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        {existing !== undefined && !existing.tracksInventory ? (
                          <span className="text-muted-foreground text-sm">{editor.notTracked}</span>
                        ) : readOnly ? (
                          <span className="text-sm">
                            {stock.readOnlyReason !== null
                              ? "—"
                              : formatNumber(locale, level?.available ?? 0)}
                          </span>
                        ) : (
                          <>
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              inputMode="numeric"
                              name={`row-${index}-available`}
                              form={PRODUCT_FORM_ID}
                              aria-label={`${editor.available}: ${title}`}
                              aria-invalid={availableError !== undefined ? true : undefined}
                              placeholder="0"
                              value={
                                typedRow?.available ??
                                (existing === undefined ? "" : String(level?.available ?? 0))
                              }
                              onChange={(event) => edit(key, { available: event.target.value })}
                            />
                            {availableError !== undefined && (
                              <p className="text-destructive mt-1 text-xs">{availableError}</p>
                            )}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        {existing !== undefined && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingId(existing.id)}
                          >
                            {editor.edit}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {stock.multipleLocations && (
              <p className="text-muted-foreground text-xs">{editor.multipleLocations}</p>
            )}
            {stock.readOnlyReason !== null && (
              <p role="note" className="text-muted-foreground text-xs">
                {editor.stockUnavailable}
              </p>
            )}
          </>
        )}
      </CardContent>

      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
      >
        {editing !== undefined && (
          <VariantDialog
            product={product}
            variant={editing}
            onClose={() => setEditingId(null)}
            t={t}
            locale={locale}
          />
        )}
      </Dialog>
    </Card>
  );
}

function VariantDialog({
  product,
  variant,
  onClose,
  t,
  locale,
}: {
  readonly product: ProductDetailDto;
  readonly variant: ProductVariantDto;
  readonly onClose: () => void;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const editor = t.productEditor;
  const [state, formAction, isPending] = useActionState(updateVariantDetailsAction, INITIAL_STATE);
  const errors = state.status === "error" ? state.fieldErrors : {};
  const { currency } = variant;
  const [tracked, setTracked] = useState(variant.tracksInventory);
  const [physical, setPhysical] = useState(variant.requiresShipping);

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {editor.editVariant}: {variantTitle(product, variant, t)}
        </DialogTitle>
        <DialogDescription>
          {editor.currency}: {currency}
        </DialogDescription>
      </DialogHeader>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="variantId" value={variant.id} />

        <PricingFields
          initial={{
            price: fromMinorUnits(variant.priceAmountMinor, currency),
            compareAtPrice:
              variant.compareAtAmountMinor === null
                ? ""
                : fromMinorUnits(variant.compareAtAmountMinor, currency),
            costPerItem:
              variant.costAmountMinor === null
                ? ""
                : fromMinorUnits(variant.costAmountMinor, currency),
            currency,
            taxable: variant.taxable,
          }}
          errors={errors}
          t={t}
          locale={locale}
          form={undefined}
          currencyEditable={false}
        />

        <section className="border-border flex flex-col gap-4 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{editor.inventoryCard}</h4>
            <Switch
              name="tracksInventory"
              label={editor.inventoryTracked}
              checked={tracked}
              onCheckedChange={setTracked}
            />
          </div>
          <InventoryBody
            tracked={tracked}
            variant={variant}
            mode="edit"
            errors={errors}
            t={t}
            form={undefined}
          />
        </section>

        <section className="border-border flex flex-col gap-4 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{editor.shippingCard}</h4>
            <Switch
              name="requiresShipping"
              label={editor.physicalProduct}
              checked={physical}
              onCheckedChange={setPhysical}
            />
          </div>
          <ShippingBody
            physical={physical}
            weightGrams={variant.weightGrams}
            errors={errors}
            t={t}
            form={undefined}
          />
        </section>

        {state.status === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        )}
        <div>
          <Button type="submit" loading={isPending}>
            {isPending ? editor.saving : editor.save}
          </Button>
        </div>
      </form>

      {product.variants.length > 1 && (
        <RemoveVariantButton productId={product.id} variantId={variant.id} t={t} />
      )}
    </DialogContent>
  );
}

function RemoveVariantButton({
  productId,
  variantId,
  t,
}: {
  readonly productId: string;
  readonly variantId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(removeProductVariantAction, INITIAL_STATE);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.productVariantsForm.confirmRemove)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="variantId" value={variantId} />
      <Button type="submit" variant="ghost" size="sm" loading={isPending} disabled={isPending}>
        {isPending ? t.productVariantsForm.removing : t.productVariantsForm.remove}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}
