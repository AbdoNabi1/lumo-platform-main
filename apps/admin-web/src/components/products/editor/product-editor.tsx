"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { Button, Card, CardContent } from "@platform/ui";
import { createProductAction, saveProductAction } from "@/app/products/actions";
import type { BrandDto } from "@/lib/api/brands";
import type { CategoryDto } from "@/lib/api/categories";
import type { FormState } from "@/lib/api/mutation";
import type { ProductDetailDto } from "@/lib/api/products";
import type { Locale } from "@/lib/i18n";
import { fromMinorUnits } from "@/lib/products/money";
import type { Dictionary } from "@/messages/en";
import { PRODUCT_FORM_ID } from "./field";
import { InventoryIdentifiersCard } from "./inventory-identifiers-card";
import { OrganizationCard } from "./organization-card";
import { PricingCard } from "./pricing-card";
import { SeoCard } from "./seo-card";
import { ShippingCard } from "./shipping-card";
import { StatusCard } from "./status-card";
import { TitleDescriptionCard } from "./title-description-card";

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
  /** Cards that own their own forms. They sit between the form cards without nesting forms. */
  readonly slots: {
    readonly variants?: ReactNode;
    readonly media?: ReactNode;
    readonly stock?: ReactNode;
    readonly dangerZone?: ReactNode;
  };
}

/**
 * Plan 2C-2 — the one-page product editor with one Save. The `<form id="product-editor">` holds
 * only hidden ids; every input in a form card joins it with `form="product-editor"`, so cards that
 * own a form of their own (variants, media, stock) can sit between them without nesting forms.
 */
export function ProductEditor(props: ProductEditorProps) {
  const { mode, product, brands, categories, defaultCurrency, t, locale, slots } = props;
  const action = mode === "create" ? createProductAction : saveProductAction;
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const [dirty, setDirty] = useState(false);
  const [title, setTitle] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");

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

  const saveLabel = isPending ? editor.saving : mode === "create" ? editor.create : editor.save;

  return (
    <div
      onInput={() => setDirty(true)}
      onChange={() => setDirty(true)}
      className="flex flex-col gap-6"
    >
      <form id={PRODUCT_FORM_ID} action={formAction}>
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
          {hasVariantFields ? (
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
              <InventoryIdentifiersCard
                sku={variant?.sku ?? ""}
                barcode={variant?.barcode ?? ""}
                isCreate={mode === "create"}
                errors={errors}
                t={t}
              />
              <ShippingCard
                requiresShipping={variant?.requiresShipping ?? true}
                weightGrams={variant?.weightGrams ?? null}
                errors={errors}
                t={t}
              />
            </>
          ) : (
            <Card>
              <CardContent className="text-muted-foreground py-6 text-sm">
                {editor.pricesOnVariants}
              </CardContent>
            </Card>
          )}
          {slots.variants ??
            (mode === "create" && (
              <Card>
                <CardContent className="text-muted-foreground py-6 text-sm">
                  {editor.optionsAfterCreate}
                </CardContent>
              </Card>
            ))}
          {slots.stock}
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
