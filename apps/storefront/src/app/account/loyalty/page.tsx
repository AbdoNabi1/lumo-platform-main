import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangleIcon, ArrowLeftIcon, AwardIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { SiteHeader } from "@/components/site-header";
import { StatePanel } from "@/components/state-panel";
import { CUSTOMER_SESSION_COOKIE } from "@/lib/customer-session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import { resolveMyLoyaltyBalance } from "@/lib/loyalty";

/**
 * The customer's loyalty-balance page (T5.19) — a read-only display surface, same `account/`
 * structure T5.17 established. Everything shown was scoped server-side by the `customerRef`
 * `CustomerGuard` derived from the opaque session cookie; this page never sends, receives, or holds
 * a `customerRef` or an `accountId`.
 *
 * Four distinct states, deliberately kept apart (same discipline as `account/wishlist/page.tsx`):
 *  - signed out  → redirect to sign-in. NOT a "no account" state: asserting anything about a loyalty
 *    account to someone who isn't signed in is false, the same T5.16 §3 reasoning the wishlist page
 *    follows.
 *  - error       → an explicit unavailable panel, never a fabricated balance.
 *  - no-account  → an honest state for a signed-in customer who has no loyalty account yet. Loyalty
 *    accounts are opened by an admin/system action (e.g. a first purchase), never self-service, so
 *    this is a real and common state, not an error.
 *  - ok          → the real balance, tier, and recent transactions.
 */
export default async function LoyaltyPage() {
  const jar = await cookies();
  const stored = jar.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);

  const result = await resolveMyLoyaltyBalance(jar.get(CUSTOMER_SESSION_COOKIE)?.value);
  if (result.status === "signed-out") redirect("/account/login");

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />

      <Link
        href="/account"
        className="text-muted-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t.account.title}
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight">{t.loyalty.title}</h1>

      {result.status === "error" ? (
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.loyalty.errorTitle}
          body={t.loyalty.errorBody}
          action={{ href: "/", label: t.loyalty.backToShop }}
        />
      ) : result.status === "no-account" ? (
        <StatePanel
          icon={<AwardIcon className="size-6" />}
          title={t.loyalty.noAccountTitle}
          body={t.loyalty.noAccountBody}
          action={{ href: "/", label: t.loyalty.backToShop }}
        />
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-6 py-8">
            <dl className="grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t.loyalty.balanceLabel}</dt>
                <dd className="text-lg font-semibold tabular-nums">{result.account.balance}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t.loyalty.tierLabel}</dt>
                <dd>{result.account.tierName}</dd>
              </div>
            </dl>

            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{t.loyalty.transactionsTitle}</h2>
              {result.account.transactions.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t.loyalty.noTransactions}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {result.account.transactions.map((transaction) => (
                    <li
                      key={transaction.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                    >
                      <span>
                        {transaction.kind}
                        {transaction.ref !== null && (
                          <span className="text-muted-foreground"> · {transaction.ref}</span>
                        )}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {transaction.pointsDelta > 0 ? "+" : ""}
                        {transaction.pointsDelta} {t.loyalty.pointsDelta} ·{" "}
                        {transaction.occurredAt.slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
