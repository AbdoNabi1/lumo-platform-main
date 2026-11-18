"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeftIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@platform/ui";
import {
  draftProductVariantsAction,
  searchDraftProductsAction,
  type DraftPickerProduct,
  type DraftPickerVariant,
} from "@/app/draft-orders/actions";
import { ProductThumb } from "@/components/products/product-thumb";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { DraftFormLine } from "@/lib/orders/draft-orders";
import type { Dictionary } from "@/messages/en";

const SEARCH_DEBOUNCE_MS = 300;

const lineOf = (v: DraftPickerVariant): DraftFormLine => ({
  productId: v.productId,
  variantId: v.variantId,
  quantity: 1,
  title: v.title,
  variantTitle: v.variantTitle,
  sku: v.sku,
  imageUrl: v.imageUrl,
  unitPriceMinor: v.priceMinor,
});

/**
 * Shopify's "Add products" browser (spec §4.9): a debounced search of the shop's sellable products;
 * a product with one variant is added at once, one with several lists them. The price shown is for
 * display only — the server prices every line on save (Ruling 12). An older answer that arrives after
 * a newer request is dropped (a request counter), for searches and variant lists alike.
 */
export function DraftProductPicker({
  initialQuery,
  onAdd,
  onClose,
  t,
  locale,
}: {
  readonly initialQuery: string;
  readonly onAdd: (line: DraftFormLine) => void;
  readonly onClose: () => void;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const k = t.draftOrders.editor.picker;
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const [products, setProducts] = useState<readonly DraftPickerProduct[] | null>(null);
  const [chosen, setChosen] = useState<{
    readonly product: DraftPickerProduct;
    readonly variants: readonly DraftPickerVariant[] | null;
  } | null>(null);
  const searchSeq = useRef(0);
  const searchField = useRef<HTMLInputElement>(null);
  const variantSeq = useRef(0);

  useEffect(() => {
    const seq = ++searchSeq.current;
    setProducts(null);
    const timer = setTimeout(() => {
      searchDraftProductsAction(query)
        .then((found) => {
          if (seq === searchSeq.current) setProducts(found);
        })
        .catch(() => {
          if (seq === searchSeq.current) setProducts([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const add = (variant: DraftPickerVariant) => {
    onAdd(lineOf(variant));
    onClose();
  };

  const choose = (product: DraftPickerProduct) => {
    const seq = ++variantSeq.current;
    setChosen({ product, variants: null });
    draftProductVariantsAction(product.id)
      .then((variants) => {
        if (seq !== variantSeq.current) return;
        const only = variants.length === 1 ? variants[0] : undefined;
        if (only !== undefined) add(only);
        else setChosen({ product, variants });
      })
      .catch(() => {
        if (seq === variantSeq.current) setChosen({ product, variants: [] });
      });
  };

  const price = (minor: number | null, currency: string | null) =>
    minor === null || currency === null ? null : formatCurrency(locale, minor, currency);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // Typing continues where the card’s search field left off: caret after the query.
          event.preventDefault();
          const input = searchField.current;
          input?.focus();
          input?.setSelectionRange(input.value.length, input.value.length);
        }}
      >
        <DialogHeader>
          <DialogTitle>{k.title}</DialogTitle>
        </DialogHeader>
        {chosen === null ? (
          <div className="flex flex-col gap-3">
            <Label htmlFor={`${id}-search`} className="sr-only">
              {k.search}
            </Label>
            <Input
              id={`${id}-search`}
              type="search"
              dir="auto"
              ref={searchField}
              maxLength={100}
              value={query}
              placeholder={k.search}
              onChange={(event) => setQuery(event.target.value)}
            />
            {products === null && <p className="text-muted-foreground text-sm">{k.loading}</p>}
            {products?.length === 0 && (
              <p className="text-muted-foreground text-sm">{k.noResults}</p>
            )}
            {products !== null && products.length > 0 && (
              <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                {products.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => choose(product)}
                      className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-3 rounded-lg p-2 text-start focus-visible:outline-none focus-visible:ring-2"
                    >
                      <ProductThumb url={product.imageUrl} alt="" />
                      <span dir="auto" className="min-w-0 flex-1 truncate font-medium">
                        {product.title}
                      </span>
                      <span className="text-muted-foreground text-sm tabular-nums">
                        {price(product.priceMinor, product.currency)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ms-2"
                onClick={() => {
                  variantSeq.current += 1;
                  setChosen(null);
                }}
              >
                <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
                {k.back}
              </Button>
              <p className="text-sm font-medium">
                {k.variants.replace("{title}", () => chosen.product.title)}
              </p>
            </div>
            {chosen.variants === null && (
              <p className="text-muted-foreground text-sm">{k.loading}</p>
            )}
            {chosen.variants?.length === 0 && (
              <p className="text-muted-foreground text-sm">{k.noResults}</p>
            )}
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {chosen.variants?.map((variant) => (
                <li key={variant.variantId} className="flex items-center gap-3 p-2">
                  <ProductThumb url={variant.imageUrl} alt="" />
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate font-medium">
                      {variant.variantTitle ?? variant.title}
                    </p>
                    <p dir="ltr" className="text-muted-foreground text-start text-xs">
                      {variant.sku}
                    </p>
                  </div>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {price(variant.priceMinor, variant.currency)}
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={() => add(variant)}>
                    {k.add}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
