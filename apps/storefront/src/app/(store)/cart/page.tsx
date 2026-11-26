import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, ArrowLeftIcon, ShoppingCartIcon } from "lucide-react";
import { CartView } from "@/components/cart-view";
import { StatePanel } from "@/components/state-panel";
import { GUEST_SESSION_COOKIE, resolveCurrentCart } from "@/lib/cart";
import { loadCheckoutSettings } from "@/lib/checkout-settings";
import { DEFAULT_PUBLIC_CHECKOUT_SETTINGS } from "@/lib/checkout-settings-model";
import { dictionaryFor } from "@/lib/i18n";
import { getPreviewToken, getRequestLocale } from "@/lib/request-locale";

/**
 * Cart page (Phase 17.1 — Guest Cart Foundation). Renders the shopper's OWN current cart, resolved
 * entirely from the guest session cookie (`GUEST_SESSION_COOKIE`) via `GET /public/carts/current`
 * — no `?cartId=` query param, no cart-id-holding cookie. A Server Component only ever READS this
 * cookie (Next.js forbids setting one outside a Server Action/Route Handler); the cookie is minted
 * the first time a shopper adds an item (`app/(store)/cart/actions.ts`), so a session-less visit here is
 * simply the empty state, never an error and never a reason to create anything.
 *
 * Mutation controls (quantity/remove/clear) live in `CartView`, a Client Component calling the
 * Server Actions in `app/(store)/cart/actions.ts` directly.
 */
export default async function CartPage() {
  const jar = await cookies();
  const locale = await getRequestLocale();
  const t = dictionaryFor(locale);
  // Ruling 15: a preview is view-only, and the owner's own cart is not part of it.
  if ((await getPreviewToken()) !== null)
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
        <StatePanel
          icon={<ShoppingCartIcon className="size-6" />}
          title={t.preview.unavailable}
          body={t.preview.banner}
        />
      </main>
    );
  const sessionRef = jar.get(GUEST_SESSION_COOKIE)?.value;

  const result = await resolveCurrentCart(sessionRef);
  // Wave 2a: the shop's add-to-cart limit caps the quantity stepper; read fresh, defaults if it fails.
  const settings =
    result.status === "error" || result.status === "empty"
      ? DEFAULT_PUBLIC_CHECKOUT_SETTINGS
      : await loadCheckoutSettings();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <Link href="/" className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
        <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t.cart.backToShop}
      </Link>

      {result.status === "error" ? (
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.cart.errorTitle}
          body={t.cart.errorBody}
          action={{ href: "/", label: t.cart.backToShop }}
        />
      ) : result.status === "empty" || result.cart.items.length === 0 ? (
        <StatePanel
          icon={<ShoppingCartIcon className="size-6" />}
          title={t.cart.emptyTitle}
          body={t.cart.emptyBody}
          action={{ href: "/", label: t.cart.backToShop }}
        />
      ) : (
        <CartView
          cart={result.cart}
          lines={result.lines}
          t={t}
          locale={locale}
          settings={settings}
        />
      )}
    </main>
  );
}
