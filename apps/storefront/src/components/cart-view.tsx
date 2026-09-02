"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, CardTitle } from "@platform/ui";
import { changeQuantity, clearCart, removeItem, type CartActionResult } from "@/app/cart/actions";
import { startCheckout } from "@/app/checkout/actions";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { ResolvedCartLine } from "@/lib/cart";
import type { Locale } from "@/lib/i18n";
import type { CartSummary } from "@/lib/runtime-api";
import type { Dictionary } from "@/messages/en";

/** Looks up the cart's status label, falling back to the raw status for any value not in the dictionary. */
function cartStatusLabel(status: string, t: Dictionary): string {
  const labels: Readonly<Record<string, string>> = t.cart.status;
  return labels[status] ?? status;
}

/** Maps a failed mutation's reason to the dictionary body copy for the "API error" / "ownership error" states (Task 8). */
function errorBody(reason: "unavailable" | "ownership" | "network", t: Dictionary): string {
  if (reason === "ownership") return t.cart.ownershipErrorBody;
  return t.cart.networkErrorBody;
}

/**
 * Renders the caller's current cart: its lines (name/slug from Catalog when resolvable, quantity
 * stepper, unit price, line total, remove) and its subtotal, plus a clear-cart action (Task 8).
 * Client Component — every line is interactive, so the whole view is one, rather than splitting
 * off a small island per control.
 */
export function CartView({
  cart,
  lines,
  t,
  locale,
}: {
  readonly cart: CartSummary;
  readonly lines: readonly ResolvedCartLine[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [pendingClear, setPendingClear] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState(false);
  const [error, setError] = useState<"unavailable" | "ownership" | "network" | null>(null);
  const [checkoutError, setCheckoutError] = useState(false);

  function afterMutation(result: CartActionResult): void {
    setPendingProductId(null);
    setPendingClear(false);
    if (!result.ok) {
      setError(result.reason === "unavailable" ? "network" : result.reason);
      return;
    }
    setError(null);
  }

  function onQuantityChange(productId: string, nextQuantity: number): void {
    if (nextQuantity < 1) return;
    setPendingProductId(productId);
    startTransition(async () => {
      afterMutation(await changeQuantity(cart.id, productId, nextQuantity));
    });
  }

  function onRemove(productId: string): void {
    setPendingProductId(productId);
    startTransition(async () => {
      afterMutation(await removeItem(cart.id, productId));
    });
  }

  function onClear(): void {
    setPendingClear(true);
    startTransition(async () => {
      afterMutation(await clearCart(cart.id));
    });
  }

  function onProceedToCheckout(): void {
    setPendingCheckout(true);
    startTransition(async () => {
      const result = await startCheckout(cart.id);
      setPendingCheckout(false);
      if (!result.ok) {
        setCheckoutError(true);
        return;
      }
      setCheckoutError(false);
      router.push("/checkout");
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <h1>
          <CardTitle as="div">{t.cart.title}</CardTitle>
        </h1>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">
            {t.cart.itemCount.replace("{count}", formatNumber(locale, lines.length))}
          </span>
          {cart.status !== "active" && (
            <Badge variant="neutral">{cartStatusLabel(cart.status, t)}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error !== null && (
          <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            <p className="font-medium">{t.cart.mutationErrorTitle}</p>
            <p>{errorBody(error, t)}</p>
          </div>
        )}
        <ul className="flex flex-col gap-2">
          {lines.map((line) => {
            const linePending = isPending && pendingProductId === line.productId;
            return (
              <li
                key={line.productId}
                className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex flex-col gap-0.5">
                  {line.slug !== null ? (
                    <Link href={`/products/${line.slug}`} className="font-medium hover:underline">
                      {line.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{line.name ?? t.cart.productUnavailable}</span>
                  )}
                  <span className="text-muted-foreground text-xs">
                    {t.cart.unitPrice.replace(
                      "{price}",
                      formatCurrency(locale, line.unitPriceAmountMinor, line.currency),
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t.cart.decreaseQuantity}
                      disabled={linePending || line.quantity <= 1}
                      onClick={() => onQuantityChange(line.productId, line.quantity - 1)}
                    >
                      <MinusIcon aria-hidden="true" />
                    </Button>
                    <span aria-live="polite" className="w-6 text-center tabular-nums">
                      {linePending ? "…" : formatNumber(locale, line.quantity)}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t.cart.increaseQuantity}
                      disabled={linePending}
                      onClick={() => onQuantityChange(line.productId, line.quantity + 1)}
                    >
                      <PlusIcon aria-hidden="true" />
                    </Button>
                  </div>
                  <span className="w-20 text-end font-medium">
                    {formatCurrency(locale, line.lineTotalAmountMinor, line.currency)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t.cart.remove}
                    disabled={linePending}
                    onClick={() => onRemove(line.productId)}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-3">
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || lines.length === 0}
            onClick={onClear}
          >
            {pendingClear && isPending ? t.cart.clearing : t.cart.clearCart}
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t.cart.subtotal}</span>
            <span className="text-base font-semibold">
              {formatCurrency(locale, cart.subtotalAmountMinor, cart.currency)}
            </span>
          </div>
        </div>
        {checkoutError && <p className="text-destructive text-xs">{t.cart.checkoutErrorBody}</p>}
        <Button
          type="button"
          disabled={isPending || lines.length === 0}
          loading={pendingCheckout && isPending}
          onClick={onProceedToCheckout}
        >
          {pendingCheckout && isPending ? t.cart.startingCheckout : t.cart.proceedToCheckout}
        </Button>
      </CardFooter>
    </Card>
  );
}
