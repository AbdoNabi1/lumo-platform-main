"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent } from "@platform/ui";
import {
  moveToCart,
  removeFromWishlist,
  shareWishlistProduct,
  type WishlistActionResult,
} from "@/app/account/wishlist/actions";
import type { ResolvedWishlistLine } from "@/lib/wishlist";
import type { Dictionary } from "@/messages/en";

/**
 * The wishlist's interactive surface (T5.17 Part B) — remove, move-to-cart, and share per line.
 * A Client Component only for pending/error state; every mutation is a Server Action that reads the
 * HttpOnly customer session cookie server-side. This component never sees a session id, a wishlist
 * id, or a `customerRef` — it passes a `productRef` and nothing else, because that is all the
 * `/me`-scoped routes accept.
 *
 * A line whose product no longer resolves in Catalog renders an explicit "no longer available"
 * label rather than a fabricated name (and offers no move-to-cart, since there is no price to add
 * it at) — the same rule `lib/cart.ts` follows for an unresolvable cart line.
 */
export function WishlistView({
  lines,
  t,
}: {
  readonly lines: readonly ResolvedWishlistLine[];
  readonly t: Dictionary;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Readonly<Record<string, string>>>({});

  function messageFor(reason: "signed-out" | "cart" | "network"): string {
    if (reason === "signed-out") return t.wishlist.errors.signedOut;
    return reason === "cart" ? t.wishlist.errors.cart : t.wishlist.errors.network;
  }

  function run(
    key: string,
    action: () => Promise<WishlistActionResult & { readonly shareToken?: string }>,
    productRef: string,
  ): void {
    setBusy(key);
    setError(null);
    startTransition(async () => {
      const result = await action();
      setBusy(null);
      if (!result.ok) {
        setError(messageFor(result.reason));
        return;
      }
      if (result.shareToken !== undefined) {
        setTokens((current) => ({ ...current, [productRef]: result.shareToken as string }));
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error !== null && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      {lines.map((line) => {
        const token = tokens[line.productRef] ?? line.shareToken;
        return (
          <Card key={line.productRef}>
            <CardContent className="flex flex-col gap-3 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {line.slug !== null && line.name !== null ? (
                  <Link href={`/products/${line.slug}`} className="text-sm font-medium underline">
                    {line.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground text-sm">
                    {t.wishlist.unknownProduct}
                  </span>
                )}
                <span className="text-muted-foreground text-xs">
                  {t.wishlist.addedOn} {line.addedAt.slice(0, 10)}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {line.slug !== null && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending}
                    loading={busy === `move:${line.productRef}`}
                    onClick={() =>
                      run(
                        `move:${line.productRef}`,
                        () => moveToCart(line.productRef),
                        line.productRef,
                      )
                    }
                  >
                    {busy === `move:${line.productRef}`
                      ? t.wishlist.movingToCart
                      : t.wishlist.moveToCart}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  loading={busy === `remove:${line.productRef}`}
                  onClick={() =>
                    run(
                      `remove:${line.productRef}`,
                      () => removeFromWishlist(line.productRef),
                      line.productRef,
                    )
                  }
                >
                  {busy === `remove:${line.productRef}` ? t.wishlist.removing : t.wishlist.remove}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  loading={busy === `share:${line.productRef}`}
                  onClick={() =>
                    run(
                      `share:${line.productRef}`,
                      () => shareWishlistProduct(line.productRef),
                      line.productRef,
                    )
                  }
                >
                  {busy === `share:${line.productRef}` ? t.wishlist.sharing : t.wishlist.share}
                </Button>
              </div>

              {token !== null && token !== undefined && (
                <div className="flex flex-col gap-1">
                  <p className="text-muted-foreground text-xs">
                    {t.wishlist.shareToken}: <code className="text-foreground">{token}</code>
                  </p>
                  {/* Deliberately does not render a link — nothing can resolve a share token yet. */}
                  <p className="text-muted-foreground text-xs">{t.wishlist.shareTokenHint}</p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
