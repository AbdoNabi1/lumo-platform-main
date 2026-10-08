"use client";

import { useActionState, useEffect, useState } from "react";
import { CheckIcon, PlusIcon } from "lucide-react";
import {
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
import {
  removeProductVariantAction,
  saveProductOptionsAction,
  updateVariantDetailsAction,
} from "@/app/products/actions";
import type { FormState } from "@/lib/api/mutation";
import type { ProductDetailDto, ProductVariantDto } from "@/lib/api/products";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { fromMinorUnits } from "@/lib/products/money";
import { MAX_OPTIONS, planOptionChange, type MatrixOption } from "@/lib/products/variant-matrix";
import type { Dictionary } from "@/messages/en";
import { CheckboxRow, Field, NativeSelect } from "./field";
import { weightDefaults } from "./shipping-card";

const INITIAL_STATE: FormState = { status: "idle" };

interface OptionRow {
  readonly key: number;
  readonly name: string;
  readonly values: string;
}

/** Splits one values input the way the server action does: on commas, trimmed, blanks dropped. */
function valuesOf(text: string): string[] {
  return text
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function optionsOf(rows: readonly OptionRow[]): MatrixOption[] {
  return rows.map((row) => ({ name: row.name.trim(), values: valuesOf(row.values) }));
}

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
 * Plan 2C-2 — options and variants. The option editor is its own form (it is NOT tied to the
 * product form), previewing with the same `planOptionChange` the server action runs; the table
 * lists every variant, and a dialog edits one variant's price, identifiers and shipping.
 */
export function VariantsCard({
  product,
  t,
  locale,
}: {
  readonly product: ProductDetailDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = product.variants.find((variant) => variant.id === editingId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.productEditor.variantsCard}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <OptionEditor product={product} t={t} />

        <Table aria-label={t.productEditor.variantsCard}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.productDetail.variants}</TableHead>
              <TableHead className="text-end">{t.productDetail.variantPrice}</TableHead>
              <TableHead>{t.productDetail.variantSku}</TableHead>
              <TableHead className="text-end">
                <span className="sr-only">{t.productEditor.editVariant}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {product.variants.map((variant) => (
              <TableRow key={variant.id}>
                <TableCell>{variantTitle(product, variant, t)}</TableCell>
                <TableCell className="text-end">
                  {formatCurrency(locale, variant.priceAmountMinor, variant.currency)}
                </TableCell>
                <TableCell className="font-mono text-xs">{variant.sku}</TableCell>
                <TableCell className="text-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingId(variant.id)}
                  >
                    {t.productEditor.editVariant}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
          />
        )}
      </Dialog>
    </Card>
  );
}

function OptionEditor({
  product,
  t,
}: {
  readonly product: ProductDetailDto;
  readonly t: Dictionary;
}) {
  const editor = t.productEditor;
  const [state, formAction, isPending] = useActionState(saveProductOptionsAction, INITIAL_STATE);
  const [nextKey, setNextKey] = useState(product.options.length);
  const [rows, setRows] = useState<readonly OptionRow[]>(
    product.options.map((option, index) => ({
      key: index,
      name: option.name,
      values: option.values.join(", "),
    })),
  );

  const nextOptions = optionsOf(rows);
  const changed = JSON.stringify(nextOptions) !== JSON.stringify(optionsOf(initialRowsOf(product)));
  const touched = rows.some((row) => row.name.trim().length > 0 || row.values.trim().length > 0);
  const plan = planOptionChange({
    productSku: product.sku,
    variants: product.variants,
    nextOptions,
  });

  function update(key: number, patch: Partial<Pick<OptionRow, "name" | "values">>): void {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow(): void {
    setRows((current) => [...current, { key: nextKey, name: "", values: "" }]);
    setNextKey((current) => current + 1);
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!plan.ok) {
          event.preventDefault();
          return;
        }
        if (
          plan.summary.removes > 0 &&
          !window.confirm(
            editor.confirmRemoveVariants.replace("{count}", String(plan.summary.removes)),
          )
        ) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="productId" value={product.id} />

      {rows.map((row) => (
        <div key={row.key} className="grid items-end gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <Field label={editor.optionName} name="optionName">
            {(control) => (
              <Input
                {...control}
                value={row.name}
                onChange={(event) => update(row.key, { name: event.target.value })}
              />
            )}
          </Field>
          <Field label={editor.optionValues} name="optionValues">
            {(control) => (
              <Input
                {...control}
                value={row.values}
                onChange={(event) => update(row.key, { values: event.target.value })}
              />
            )}
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
          >
            {editor.removeOption}
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        {rows.length === 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <PlusIcon aria-hidden="true" />
            {editor.addOptions}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRow}
            disabled={rows.length >= MAX_OPTIONS}
          >
            <PlusIcon aria-hidden="true" />
            {editor.addAnotherOption}
          </Button>
        )}
        {(rows.length > 0 || changed) && (
          <Button
            type="submit"
            size="sm"
            loading={isPending}
            disabled={isPending || !changed || !plan.ok}
          >
            {editor.saveOptions}
          </Button>
        )}
      </div>

      {changed && plan.ok && (
        <p className="text-muted-foreground text-sm">
          {editor.matrixPreview
            .replace("{adds}", String(plan.summary.adds))
            .replace("{removes}", String(plan.summary.removes))}
        </p>
      )}
      {!plan.ok && touched && (
        <p role="note" className="text-destructive text-sm">
          {plan.reason === "too_many_variants" ? editor.tooManyVariants : editor.invalidOptions}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="text-muted-foreground flex items-center gap-1 text-xs">
          <CheckIcon aria-hidden="true" className="size-3.5" />
          {t.productWriteCommon.saved}
        </p>
      )}
    </form>
  );
}

function initialRowsOf(product: ProductDetailDto): readonly OptionRow[] {
  return product.options.map((option, index) => ({
    key: index,
    name: option.name,
    values: option.values.join(", "),
  }));
}

function VariantDialog({
  product,
  variant,
  onClose,
  t,
}: {
  readonly product: ProductDetailDto;
  readonly variant: ProductVariantDto;
  readonly onClose: () => void;
  readonly t: Dictionary;
}) {
  const editor = t.productEditor;
  const [state, formAction, isPending] = useActionState(updateVariantDetailsAction, INITIAL_STATE);
  const errors = state.status === "error" ? state.fieldErrors : {};
  const { currency } = variant;
  const weight = weightDefaults(variant.weightGrams);

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

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={editor.price} name="price" error={errors["price"]}>
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                defaultValue={fromMinorUnits(variant.priceAmountMinor, currency)}
              />
            )}
          </Field>
          <Field
            label={editor.compareAtPrice}
            name="compareAtPrice"
            error={errors["compareAtPrice"]}
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                defaultValue={
                  variant.compareAtAmountMinor === null
                    ? ""
                    : fromMinorUnits(variant.compareAtAmountMinor, currency)
                }
              />
            )}
          </Field>
          <Field label={editor.costPerItem} name="costPerItem" error={errors["costPerItem"]}>
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                defaultValue={
                  variant.costAmountMinor === null
                    ? ""
                    : fromMinorUnits(variant.costAmountMinor, currency)
                }
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={editor.sku} name="sku" error={errors["sku"]}>
            {(control) => <Input {...control} defaultValue={variant.sku} />}
          </Field>
          <Field label={editor.barcode} name="barcode" error={errors["barcode"]}>
            {(control) => <Input {...control} defaultValue={variant.barcode ?? ""} />}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field label={editor.weight} name="weight" error={errors["weight"]}>
            {(control) => <Input {...control} inputMode="decimal" defaultValue={weight.value} />}
          </Field>
          <Field label={editor.weightUnit} name="weightUnit">
            {(control) => (
              <NativeSelect {...control} defaultValue={weight.unit}>
                <option value="g">{editor.grams}</option>
                <option value="kg">{editor.kilograms}</option>
              </NativeSelect>
            )}
          </Field>
        </div>

        <CheckboxRow
          name="requiresShipping"
          label={editor.physicalProduct}
          defaultChecked={variant.requiresShipping}
        />
        <CheckboxRow name="taxable" label={editor.chargeTax} defaultChecked={variant.taxable} />

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
