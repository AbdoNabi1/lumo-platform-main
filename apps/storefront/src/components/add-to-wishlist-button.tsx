"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { HeartIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { addToWishlist } from "@/app/account/wishlist/actions";
import type { Dictionary } from "@/messages/en";

/**
 * "Save for later" on a product card / detail page (T5.17 Part B).
 *
 * **Rendered only when a customer session exists** — the caller decides, server-side, because a
 * wishlist has nothing to be scoped to for an anonymous shopper (T5.16 §4: the `customerRef` is the
 * whole point). This component is therefore never shown to a guest at all, rather than being shown
 * and failing on click.
 *
 * It still handles the signed-out result, because a session can expire between the page render and
 * the click. That case shows a sign-in link rather than a bare error — the honest recovery.
 */
export function AddToWishlistButton({
  productRef,
  t,
}: {
  readonly productRef: string;
  readonly t: Dictionary;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<"idle" | "ok" | "signed-out" | "error">("idle");

  function onClick(): void {
    startTransition(async () => {
      const response = await addToWishlist(productRef);
      if (response.ok) {
        setResult("ok");
        return;
      }
      setResult(response.reason === "signed-out" ? "signed-out" : "error");
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        loading={isPending}
        onClick={onClick}
      >
        <HeartIcon aria-hidden="true" className="size-4" />
        {isPending ? t.wishlist.adding : t.wishlist.add}
      </Button>
      {result === "ok" && (
        <p className="text-muted-foreground text-xs">
          {t.wishlist.added}{" "}
          <Link href="/account/wishlist" className="text-foreground underline">
            {t.wishlist.link}
          </Link>
        </p>
      )}
      {result === "signed-out" && (
        <p className="text-destructive text-xs">
          <Link href="/account/login" className="underline">
            {t.wishlist.errors.signedOut}
          </Link>
        </p>
      )}
      {result === "error" && <p className="text-destructive text-xs">{t.wishlist.errors.network}</p>}
    </div>
  );
}
