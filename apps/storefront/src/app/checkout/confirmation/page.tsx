import { cookies } from "next/headers";
import { CheckCircle2Icon, PackageXIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { ClearCheckoutSessionCookie } from "@/components/clear-checkout-session-cookie";
import { SiteHeader } from "@/components/site-header";
import { StatePanel } from "@/components/state-panel";
import { CHECKOUT_SESSION_COOKIE, GUEST_SESSION_COOKIE } from "@/lib/cart";
import { formatCurrency } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import { getCheckoutSession } from "@/lib/runtime-api";

/**
 * Order confirmation (Phase 2 — Public checkout, T2.6). Renders only what the public checkout
 * session DTO returns (`orderRef` + `totals`) — never `GET /checkouts/:id/order-draft` (deliberately
 * not public, see `public-checkout-routes.ts`'s header comment) and never `GET /orders/:orderId`
 * (admin-guarded; a shopper has no token). See `docs/plans/BLOCKERS.md`'s T2.3 entry: completing a
 * checkout for a genuine guest session currently fails server-side (`OrderCreationAdapter` requires
 * a `customerRef`, which guest checkout never has) — so `orderRef` being absent here is a real,
 * currently-reachable state, not a hypothetical one, and is rendered as a recoverable "nothing to
 * confirm" panel rather than assumed away.
 *
 * Resolves the just-completed session from `CHECKOUT_SESSION_COOKIE` (kept alive by
 * `completeCheckout` on purpose — see that action's own comment) and clears it once rendered via
 * `ClearCheckoutSessionCookie`.
 */
export default async function CheckoutConfirmationPage() {
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

  const orderRef =
    session !== null && session.status >= 200 && session.status < 300
      ? (session.body?.orderRef ?? null)
      : null;
  const totals = session?.body?.totals ?? null;
  const currency = session?.body?.currency;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />
      <ClearCheckoutSessionCookie />

      {orderRef === null ? (
        <StatePanel
          icon={<PackageXIcon className="size-6" />}
          title={t.checkout.confirmation.missingTitle}
          body={t.checkout.confirmation.missingBody}
          action={{ href: "/", label: t.checkout.confirmation.backToShop }}
        />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <span
              className="bg-success-subtle text-success-foreground flex size-12 items-center justify-center rounded-lg"
              aria-hidden="true"
            >
              <CheckCircle2Icon className="size-6" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t.checkout.confirmation.title}
            </h1>
            <p className="text-muted-foreground text-md max-w-md" role="note">
              {t.checkout.confirmation.body}
            </p>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t.checkout.confirmation.orderReference}</dt>
                <dd className="font-medium">{orderRef}</dd>
              </div>
              {totals !== null && currency !== undefined && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t.checkout.confirmation.total}</dt>
                  <dd className="font-medium">
                    {formatCurrency(locale, totals.grandTotalMinor, currency)}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
