"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@platform/ui";
import {
  searchCollectionProductsAction,
  type CollectionPickerProduct,
} from "@/app/collections/actions";
import type { Dictionary } from "@/messages/en";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * "Browse" for a collection: a debounced search of the shop's products — every status, a
 * collection may hold drafts — in a real `Dialog`. It picks a PRODUCT (never a variant) and only
 * reports its id; the card adds it. An older answer that arrives after a newer request is dropped
 * (a request counter), so a slow first search can never overwrite the list the merchant is looking at.
 */
export function CollectionProductPicker({
  excludeIds = [],
  onPick,
  onClose,
  returnFocusRef,
  t,
}: {
  /** Ids already in the collection: listed, but not pickable again. */
  readonly excludeIds?: readonly string[];
  readonly onPick: (productId: string) => void;
  readonly onClose: () => void;
  /** Where focus goes when the dialog closes: the control that opened it (the card unmounts this component on close, so Radix has no trigger to return to). */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly t: Dictionary;
}) {
  const k = t.collections.picker;
  const id = useId();
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<readonly CollectionPickerProduct[] | null>(null);
  const searchSeq = useRef(0);
  const searchField = useRef<HTMLInputElement>(null);
  const statusLabels: Readonly<Record<string, string>> = t.productStatus;

  useEffect(() => {
    const seq = ++searchSeq.current;
    setProducts(null);
    const timer = setTimeout(() => {
      searchCollectionProductsAction(query)
        .then((found) => {
          if (seq === searchSeq.current) setProducts(found);
        })
        .catch(() => {
          if (seq === searchSeq.current) setProducts([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchField.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{k.title}</DialogTitle>
          <DialogDescription>{k.description}</DialogDescription>
        </DialogHeader>
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
          {products?.length === 0 && <p className="text-muted-foreground text-sm">{k.noResults}</p>}
          {products !== null && products.length > 0 && (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {products.map((product) => {
                const added = excludeIds.includes(product.id);
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => {
                        onPick(product.id);
                        onClose();
                      }}
                      className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-3 rounded-lg p-2 text-start focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <bdi dir="auto" className="min-w-0 flex-1 truncate font-medium">
                        {product.name}
                      </bdi>
                      <span className="text-muted-foreground text-sm">
                        {added ? k.alreadyAdded : (statusLabels[product.status] ?? product.status)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
