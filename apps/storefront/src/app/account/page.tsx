import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangleIcon, ArrowLeftIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { SiteHeader } from "@/components/site-header";
import { SignOutButton } from "@/components/sign-out-button";
import { StatePanel } from "@/components/state-panel";
import { CUSTOMER_SESSION_COOKIE, resolveCurrentCustomer } from "@/lib/customer-session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";

/**
 * The account landing page (T5.17 Part A) — deliberately minimal. Its job is to PROVE the session
 * foundation works end to end, not to be a profile UI: everything it renders (name, email) was
 * resolved server-side from the opaque session cookie through
 * `CustomerGuard`'s session → principal → customer hop. Nothing on this page is read from the
 * cookie itself, because the cookie contains nothing readable — only a session id.
 *
 * Three distinct states, never collapsed into two:
 *  - signed in  → the real profile, fetched on this request.
 *  - signed out → redirect to `/account/login` (no cookie, or one the server refused).
 *  - error      → an explicit unavailable panel. A failed API call must NEVER be rendered as
 *    "signed out"; that would silently sign a customer out of the UI on any transient hiccup, and
 *    it is the same "absence means anonymous" fabrication the storefront's rules forbid elsewhere.
 */
export default async function AccountPage() {
  const jar = await cookies();
  const stored = jar.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);

  const result = await resolveCurrentCustomer(jar.get(CUSTOMER_SESSION_COOKIE)?.value);
  if (result.status === "signed-out") redirect("/account/login");

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />

      <Link href="/" className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
        <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t.account.backToShop}
      </Link>

      {result.status === "error" ? (
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.account.errorTitle}
          body={t.account.errorBody}
          action={{ href: "/", label: t.account.backToShop }}
        />
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-6 py-8">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">{t.account.title}</h1>
              <p className="text-muted-foreground text-sm">
                {t.account.signedInAs} {result.customer.email}
              </p>
            </div>

            <dl className="grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t.account.name}</dt>
                <dd>{result.customer.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t.account.email}</dt>
                <dd>{result.customer.email}</dd>
              </div>
            </dl>

            <Link href="/account/wishlist" className="text-sm underline">
              {t.wishlist.link}
            </Link>

            <Link href="/account/loyalty" className="text-sm underline">
              {t.loyalty.link}
            </Link>

            <SignOutButton t={t} />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
