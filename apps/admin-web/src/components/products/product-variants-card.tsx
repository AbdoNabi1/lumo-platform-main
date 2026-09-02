"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { CheckIcon, PlusIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import {
  addProductVariantAction,
  removeProductVariantAction,
  updateProductVariantAction,
} from "@/app/products/actions";
import type { FormState } from "@/lib/api/mutation";
import type { ProductVariantDto } from "@/lib/api/products";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

export function ProductVariantsCard({
  productId,
  variants,
  t,
  locale,
}: {
  readonly productId: string;
  readonly variants: readonly ProductVariantDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.productDetail.variants}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-0 sm:p-0">
        <Table aria-label={t.productDetail.variants}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.productDetail.variantSku}</TableHead>
              <TableHead>{t.productDetail.variantOptions}</TableHead>
              <TableHead className="text-end">{t.productDetail.variantPrice}</TableHead>
              <TableHead className="text-end">{t.productVariantsForm.edit}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((variant) =>
              editingId === variant.id ? (
                <VariantEditRow
                  key={variant.id}
                  productId={productId}
                  variant={variant}
                  t={t}
                  onDone={() => setEditingId(null)}
                />
              ) : (
                <TableRow key={variant.id}>
                  <TableCell className="font-mono text-xs">{variant.sku}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {variant.selection === null
                      ? t.productDetail.noOptions
                      : Object.entries(variant.selection)
                          .map(([name, value]) => `${name}: ${value}`)
                          .join(", ")}
                  </TableCell>
                  <TableCell className="text-end font-medium tabular-nums">
                    {formatCurrency(locale, variant.priceAmountMinor, variant.currency)}
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(variant.id)}
                      >
                        {t.productVariantsForm.edit}
                      </Button>
                      <RemoveVariantButton productId={productId} variantId={variant.id} t={t} />
                    </div>
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>

        <div className="px-4 pb-4 sm:px-5">
          <AddVariantForm productId={productId} t={t} />
        </div>
      </CardContent>
    </Card>
  );
}

function VariantEditRow({
  productId,
  variant,
  t,
  onDone,
}: {
  readonly productId: string;
  readonly variant: ProductVariantDto;
  readonly t: Dictionary;
  readonly onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(updateProductVariantAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  // A successful save closes the inline editor — the refreshed row (via `revalidatePath` in the
  // action) then renders in its place. Done in an effect, not during render, since `onDone`
  // updates a different component's (the parent's) state.
  useEffect(() => {
    if (state.status === "success") {
      onDone();
    }
  }, [state.status, onDone]);

  return (
    <TableRow>
      <TableCell colSpan={4}>
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="variantId" value={variant.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${formId}-sku`} className="text-xs">
              {t.productVariantsForm.sku}
            </Label>
            <Input
              id={`${formId}-sku`}
              name="sku"
              defaultValue={variant.sku}
              className="h-8 w-32 text-xs"
              aria-invalid={fieldErrors["sku"] !== undefined || undefined}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${formId}-price`} className="text-xs">
              {t.productVariantsForm.price}
            </Label>
            <Input
              id={`${formId}-price`}
              name="priceAmountMinor"
              inputMode="numeric"
              defaultValue={String(variant.priceAmountMinor)}
              className="h-8 w-28 text-xs"
              aria-invalid={fieldErrors["priceAmountMinor"] !== undefined || undefined}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${formId}-currency`} className="text-xs">
              {t.productVariantsForm.currency}
            </Label>
            <Input
              id={`${formId}-currency`}
              name="currency"
              maxLength={3}
              defaultValue={variant.currency}
              className="h-8 w-16 text-xs"
              aria-invalid={fieldErrors["currency"] !== undefined || undefined}
            />
          </div>
          <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
            {isPending ? t.productVariantsForm.saving : t.productVariantsForm.save}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            {t.productVariantsForm.cancel}
          </Button>
          {state.status === "error" && (
            <p role="alert" className="text-destructive w-full text-xs">
              {state.message}
            </p>
          )}
        </form>
      </TableCell>
    </TableRow>
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

function AddVariantForm({ productId, t }: { readonly productId: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(addProductVariantAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="productId" value={productId} />
      <h3 className="text-sm font-medium">{t.productVariantsForm.addTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-sku`} className="text-xs">
            {t.productVariantsForm.sku}
          </Label>
          <Input
            id={`${formId}-sku`}
            name="sku"
            className="h-8 w-32 text-xs"
            aria-invalid={fieldErrors["sku"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-price`} className="text-xs">
            {t.productVariantsForm.price}
          </Label>
          <Input
            id={`${formId}-price`}
            name="priceAmountMinor"
            inputMode="numeric"
            className="h-8 w-28 text-xs"
            aria-invalid={fieldErrors["priceAmountMinor"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-currency`} className="text-xs">
            {t.productVariantsForm.currency}
          </Label>
          <Input
            id={`${formId}-currency`}
            name="currency"
            maxLength={3}
            className="h-8 w-16 text-xs"
            aria-invalid={fieldErrors["currency"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-selection`} className="text-xs">
            {t.productVariantsForm.selection}
          </Label>
          <Input
            id={`${formId}-selection`}
            name="selection"
            className="h-8 w-48 text-xs"
            aria-invalid={fieldErrors["selection"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          <PlusIcon aria-hidden="true" />
          {isPending ? t.productVariantsForm.adding : t.productVariantsForm.add}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
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
