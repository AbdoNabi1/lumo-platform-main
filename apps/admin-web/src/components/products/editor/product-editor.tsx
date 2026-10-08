"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button, Card, CardContent } from "@platform/ui";
import { createProductAction, saveProductAction } from "@/app/products/actions";
import type { BrandDto } from "@/lib/api/brands";
import type { CategoryDto } from "@/lib/api/categories";
import type { FormState } from "@/lib/api/mutation";
import type { ProductDetailDto } from "@/lib/api/products";
import type { Locale } from "@/lib/i18n";
import { fromMinorUnits } from "@/lib/products/money";
import type { StockView } from "@/lib/products/stock";
import type { Dictionary } from "@/messages/en";
import { PRODUCT_FORM_ID } from "./field";
import { InventoryCard } from "./inventory-card";
import { OrganizationCard } from "./organization-card";
import { PricingCard } from "./pricing-card";
import { SeoCard } from "./seo-card";
import { ShippingCard } from "./shipping-card";
import { StatusCard } from "./status-card";
import { TitleDescriptionCard } from "./title-description-card";
import { VariantsCard } from "./variants-card";

export { PRODUCT_FORM_ID };

const INITIAL_STATE: FormState = { status: "idle" };

export interface ProductEditorProps {
  readonly mode: "create" | "edit";
  /** `null` in create mode. */
  readonly product: ProductDetailDto | null;
  readonly brands: readonly BrandDto[];
  readonly categories: readonly CategoryDto[];
  /** Create mode's starting currency; edit mode uses the variant's own. */
  readonly defaultCurrency: string;
  readonly t: Dictionary;
  readonly locale: Locale;
  /** Quantities and the one location they belong to (Plan 2B-2). */
  readonly stock: StockView;
  /** Cards that own their own forms. They sit between the form cards without nesting forms. */
  readonly slots: {
    readonly media?: ReactNode;
    readonly dangerZone?: ReactNode;
  };
}

/**
 * Plan 2C-2 / 2B-2 — the one-page product editor with one Save. The `<form id="product-editor">`
 * holds only hidden ids; every input in a form card joins it with `form="product-editor"`, so cards
 * that own a form of their own (media) can sit between them without nesting forms. The options
 * editor, the variants table and the inventory card all join it: options, prices, quantities and
 * every other field save together.
 */
export function ProductEditor(props: ProductEditorProps) {
  const { mode, product, brands, categories, defaultCurrency, t, locale, stock, slots } = props;
  const action = mode === "create" ? createProductAction : saveProductAction;
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const [dirty, setDirty] = useState(false);
  const [title, setTitle] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [pendingRemovals, setPendingRemovals] = useState(0);
  const [optionCount, setOptionCount] = useState(product?.options.length ?? 0);
  const onPlanChange = useCallback(
    (summary: { adds: number; removes: number }) => setPendingRemovals(summary.removes),
    [],
  );

  useEffect(() => {
    if (state.status === "success") setDirty(false);
  }, [state]);

  const errors: Readonly<Record<string, string>> =
    state.status === "error" ? state.fieldErrors : {};
  const variant =
    product !== null && product.variants.length === 1 && product.options.length === 0
      ? product.variants[0]
      : undefined;
  const hasVariantFields = mode === "create" || variant !== undefined;
  const editor = t.productEditor;
  const currency = variant?.currency ?? defaultCurrency;

  // Only the editor's own inputs count: the media card and the variant dialog submit their own
  // forms, so typing there must not claim the page has unsaved changes.
  function markDirty(event: FormEvent): void {
    const target = event.target as { readonly form?: HTMLFormElement | null };
    if (target.form?.id === PRODUCT_FORM_ID) setDirty(true);
  }

  // The single variant's own cards (price, inventory, shipping) give way to the table the moment
  // options are typed; the server decides by the options it receives.
  const showSingleVariantCards = hasVariantFields && optionCount === 0;
  // A fresh server state (after a save) starts the card over from it.
  const variantsKey =
    product === null
      ? ""
      : JSON.stringify([
          product.options,
          product.variants.map((v) => [v.id, v.selection, v.priceAmountMinor, v.tracksInventory]),
          stock.byVariant,
          stock.location?.id ?? null,
        ]);

  const saveLabel = isPending ? editor.saving : mode === "create" ? editor.create : editor.save;

  return (
    <div onInput={markDirty} onChange={markDirty} className="flex flex-col gap-6">
      <form
        id={PRODUCT_FORM_ID}
        action={formAction}
        onSubmit={(event) => {
          if (
            pendingRemovals > 0 &&
            !window.confirm(
              editor.confirmRemoveVariants.replace("{count}", String(pendingRemovals)),
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        {product !== null && <input type="hidden" name="productId" value={product.id} />}
        {variant !== undefined && <input type="hidden" name="variantId" value={variant.id} />}
        {hasVariantFields && <input type="hidden" name="hasVariantFields" value="1" />}
      </form>

      <div className="bg-background/95 sticky top-0 z-10 flex flex-wrap items-center justify-end gap-3 py-2 backdrop-blur">
        {state.status === "error" && (
          <p role="alert" className="text-destructive me-auto text-sm">
            {state.message}
          </p>
        )}
        {dirty && <span className="text-muted-foreground text-sm">{editor.unsaved}</span>}
        <Button type="submit" form={PRODUCT_FORM_ID} loading={isPending}>
          {saveLabel}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <TitleDescriptionCard
            title={title}
            description={description}
            onTitleChange={setTitle}
            onDescriptionChange={setDescription}
            errors={errors}
            t={t}
          />
          {slots.media}
          {showSingleVariantCards && (
            <>
              <PricingCard
                initial={{
                  price:
                    variant === undefined ? "" : fromMinorUnits(variant.priceAmountMinor, currency),
                  compareAtPrice:
                    variant?.compareAtAmountMinor == null
                      ? ""
                      : fromMinorUnits(variant.compareAtAmountMinor, currency),
                  costPerItem:
                    variant?.costAmountMinor == null
                      ? ""
                      : fromMinorUnits(variant.costAmountMinor, currency),
                  currency,
                  taxable: variant?.taxable ?? true,
                }}
                errors={errors}
                t={t}
                locale={locale}
              />
              <InventoryCard variant={variant} stock={stock} mode={mode} errors={errors} t={t} />
              <ShippingCard
                requiresShipping={variant?.requiresShipping ?? true}
                weightGrams={variant?.weightGrams ?? null}
                errors={errors}
                t={t}
              />
            </>
          )}
          {mode === "edit" && product !== null ? (
            <VariantsCard
              key={variantsKey}
              product={product}
              stock={stock}
              t={t}
              locale={locale}
              errors={errors}
              onPlanChange={onPlanChange}
              onOptionCountChange={setOptionCount}
            />
          ) : (
            <Card>
              <CardContent className="text-muted-foreground py-6 text-sm">
                {editor.optionsAfterCreate}
              </CardContent>
            </Card>
          )}
          <SeoCard
            title={title}
            description={description}
            seoTitle={product?.seoTitle ?? ""}
            seoDescription={product?.seoDescription ?? ""}
            handle={product?.slug ?? ""}
            isCreate={mode === "create"}
            errors={errors}
            t={t}
          />
        </div>

        <div className="flex flex-col gap-6">
          <StatusCard status={product?.status ?? "draft"} errors={errors} t={t} />
          <OrganizationCard
            productType={product?.productType ?? ""}
            brandId={product?.brandId ?? null}
            categoryIds={product?.categoryIds ?? []}
            tags={product?.tags ?? []}
            brands={brands}
            categories={categories}
            errors={errors}
            t={t}
          />
          {slots.dangerZone}
        </div>
      </div>
    </div>
  );
}
