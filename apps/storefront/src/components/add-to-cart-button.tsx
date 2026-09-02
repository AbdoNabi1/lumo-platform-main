"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@platform/ui";
import { addToCart } from "@/app/cart/actions";
import type { Dictionary } from "@/messages/en";

/**
 * The storefront's guest add-to-cart entry point (Task 9). Fixed quantity of 1 — no quantity
 * selector on Product Detail/Collection, per the phase's own minimalism instruction; quantity is
 * adjustable afterwards on `/cart`. Calls the `addToCart` Server Action directly, which derives (or
 * mints) the guest session from the HttpOnly cookie server-side — this component never sees or
 * handles a `sessionRef`.
 */
export function AddToCartButton({
  productId,
  outOfStock,
  t,
}: {
  readonly productId: string;
  readonly outOfStock: boolean;
  readonly t: Dictionary;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<"idle" | "ok" | "unavailable" | "error">("idle");

  function onClick(): void {
    startTransition(async () => {
      const response = await addToCart(productId, 1);
      if (response.ok) {
        setResult("ok");
        return;
      }
      setResult(response.reason === "unavailable" ? "unavailable" : "error");
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        disabled={outOfStock || isPending}
        loading={isPending}
        onClick={onClick}
      >
        {isPending ? t.product.addingToCart : t.product.addToCart}
      </Button>
      {result === "ok" && (
        <p className="text-muted-foreground text-xs">
          {t.product.addedToCart}{" "}
          <Link href="/cart" className="text-foreground underline">
            {t.product.viewCart}
          </Link>
        </p>
      )}
      {result === "unavailable" && (
        <p className="text-destructive text-xs">{t.product.addToCartUnavailable}</p>
      )}
      {result === "error" && <p className="text-destructive text-xs">{t.product.addToCartError}</p>}
    </div>
  );
}
