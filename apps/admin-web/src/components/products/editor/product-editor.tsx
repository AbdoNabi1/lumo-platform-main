"use client";

import { useActionState, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import {
  createProductAction,
  duplicateProductAction,
  saveProductAction,
} from "@/app/products/actions";
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
  /**
   * The store's public address, read from `STOREFRONT_URL` by the product page at request time.
   * `null` hides Preview. Not a `NEXT_PUBLIC_` variable: those are inlined at build time, and this
   * app's image is built without build args.
   */
  readonly storefrontUrl: string | null;
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
/** Every field joined to the page's form, in page order — two equal snapshots mean nothing changed. */
function formSnapshot(): string {
  const form = document.getElementById(PRODUCT_FORM_ID);
  if (!(form instanceof HTMLFormElement)) return "";
  return JSON.stringify(
    [...new FormData(form)].map(([name, value]) => [
      name,
      typeof value === "string" ? value : value.name,
    ]),
  );
}

export function ProductEditor(props: ProductEditorProps) {
  const {
    mode,
    product,
    brands,
    categories,
    defaultCurrency,
    t,
    locale,
    stock,
    storefrontUrl,
    slots,
  } = props;
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

  // What the page's fields held when it was loaded or last saved. Save stays off until the fields
  // differ from it, and goes off again when a change is undone.
  const saved = useRef<string | null>(null);
  useEffect(() => {
    if (state.status === "error") return;
    saved.current = formSnapshot();
    setDirty(false);
  }, [state, product]);

  const errors: Readonly<Record<string, string>> =
    state.status === "error" ? state.fieldErrors : {};
  const variant =
    product !== null && product.variants.length === 1 && product.options.length === 0
      ? product.variants[0]
      : undefined;
  const hasVariantFields = mode === "create" || variant !== undefined;
  const editor = t.productEditor;
  const currency = variant?.currency ?? defaultCurrency;

  // Only the editor's own fields count: the media card and the variant dialog submit their own
  // forms, so typing there never changes the snapshot. Typing is compared at once; a click (Done,
  // remove a value, a switch) is compared again after React has drawn its result.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const compare = () => {
      if (saved.current !== null) setDirty(formSnapshot() !== saved.current);
    };
    const recheck = () => {
      compare();
      const timer = setTimeout(() => {
        timers.delete(timer);
        compare();
      }, 0);
      timers.add(timer);
    };
    const events = ["input", "change", "click", "keyup"] as const;
    for (const name of events) element.addEventListener(name, recheck);
    return () => {
      for (const name of events) element.removeEventListener(name, recheck);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

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
          stock.byLocation,
          stock.defaultLocationId,
        ]);

  // Only a product the store shows can be previewed; `storefrontUrl` is null when it is not set.
  const previewHref =
    product !== null &&
    storefrontUrl !== null &&
    (product.status === "published" || product.status === "unlisted")
      ? `${storefrontUrl.replace(/\/+$/, "")}/products/${product.slug}`
      : null;

  const saveLabel = isPending ? editor.saving : mode === "create" ? editor.create : editor.save;

  return (
    <div ref={root} className="flex flex-col gap-6">
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

      {/* top-16: below the app shell's sticky 64px header (h-16, z-30). At top-0 the header
          covered this bar once the page scrolled, so clicking Save hit the header instead. */}
      <div className="bg-background/95 sticky top-16 z-20 flex flex-wrap items-center justify-end gap-3 py-2 backdrop-blur">
        {product !== null && (
          <div className="me-auto flex flex-wrap items-center gap-2">
            {previewHref !== null && (
              <Button variant="outline" size="sm" asChild>
                <a href={previewHref} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon aria-hidden="true" />
                  {editor.preview}
                </a>
              </Button>
            )}
            <DuplicateForm productId={product.id} label={editor.duplicate} />
          </div>
        )}
        {state.status === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        )}
        {dirty && <span className="text-muted-foreground text-sm">{editor.unsaved}</span>}
        <Button
          type="submit"
          form={PRODUCT_FORM_ID}
          loading={isPending}
          disabled={!dirty || isPending}
        >
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

/**
 * Duplicate: a small form of its own. It sits beside the editor's `<form>`, never inside it, so
 * making a copy does not submit (or lose) what is typed on the page.
 */
function DuplicateForm({
  productId,
  label,
}: {
  readonly productId: string;
  readonly label: string;
}) {
  const [state, formAction, isPending] = useActionState(duplicateProductAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="productId" value={productId} />
      <Button type="submit" variant="outline" size="sm" loading={isPending} disabled={isPending}>
        <CopyIcon aria-hidden="true" />
        {label}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}
