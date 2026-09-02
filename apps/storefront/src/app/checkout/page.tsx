import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, ArrowLeftIcon } from "lucide-react";
import { CheckoutView } from "@/components/checkout-view";
import { SiteHeader } from "@/components/site-header";
import { StatePanel } from "@/components/state-panel";
import { CHECKOUT_SESSION_COOKIE, GUEST_SESSION_COOKIE } from "@/lib/cart";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import { getCheckoutSession } from "@/lib/runtime-api";

/**
 * Checkout page (Phase 2 — Public checkout). Resolves the caller's OWN active checkout session
 * from two HttpOnly cookies — `GUEST_SESSION_COOKIE` (the ownership proof) and
 * `CHECKOUT_SESSION_COOKIE` (which session, set by `startCheckout` in `app/checkout/actions.ts`) —
 * the same "a Server Component only ever READS a cookie" split `app/cart/page.tsx` uses. Missing
 * either cookie, or a 404/network failure resolving the session, all render the same recoverable
 * "back to cart" state (Task 5's rule: an ownership failure is not an error page) — this is exactly
 * what an expired or cleared checkout looks like, and a shopper should just start again from
 * `/cart`.
 *
 * Mutation controls (the stepper) live in `CheckoutView`, a Client Component calling the Server
 * Actions in `app/checkout/actions.ts` directly.
 */
export default async function CheckoutPage() {
  const jar = await cookies();
  const stored = jar.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);

  const sessionRef = jar.get(GUEST_SESSION_COOKIE)?.value;
  const checkoutSessionId = jar.get(CHECKOUT_SESSION_COOKIE)?.value;

  const session =
    sessionRef !== undefined && checkoutSessionId !== undefined
      ? await getCheckoutSession(checkoutSessionId, sessionRef)
      : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />

      <Link href="/cart" className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
        <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t.checkout.backToCart}
      </Link>

      {session === null || session.status < 200 || session.status >= 300 || session.body === null ? (
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.checkout.ownershipErrorTitle}
          body={t.checkout.ownershipErrorBody}
          action={{ href: "/cart", label: t.checkout.backToCart }}
        />
      ) : (
        <CheckoutView session={session.body} t={t} locale={locale} />
      )}
    </main>
  );
}
