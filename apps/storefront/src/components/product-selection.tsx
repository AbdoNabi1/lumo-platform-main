"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface ProductSelection {
  /** The picture of the variant the shopper has picked, or `null` when that variant has none. */
  readonly variantImageId: string | null;
  readonly setVariantImageId: (id: string | null) => void;
}

const NOTHING: ProductSelection = { variantImageId: null, setVariantImageId: () => undefined };
const Context = createContext<ProductSelection>(NOTHING);

/**
 * Plan 2C-3 — what the variant picker and the picture gallery share on the product page. The page
 * itself stays a Server Component: this provider only wraps the two client islands that need to talk
 * (picking "Large" switches the big picture to the large variant's own). Outside a provider both are
 * independent, which is how each is tested on its own.
 */
export function ProductSelectionProvider({ children }: { readonly children: ReactNode }) {
  const [variantImageId, setVariantImageId] = useState<string | null>(null);
  const value = useMemo(() => ({ variantImageId, setVariantImageId }), [variantImageId]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProductSelection(): ProductSelection {
  return useContext(Context);
}
