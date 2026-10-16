import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { SignupCompleteForm } from "@/components/signup-complete-form";
import { SiteHeader } from "@/components/site-header";
import { CUSTOMER_SESSION_COOKIE, resolveCurrentCustomer } from "@/lib/customer-session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";

/**
 * Signup-completion page (G-72): reached from the link `requestSignup` emails for a guest-checkout
 * customer. The token is read server-side, here, from `searchParams` — and handed only to
 * {@link SignupCompleteForm}'s Server Action, never rendered into a client-visible `<a href>`,
 * logged, or otherwise re-exposed. The storefront has no page-view/analytics tracking today (there
 * is nothing to suppress), but if one is ever added, this URL's `token` query param must stay out
 * of it, the same H-05 discipline `x-customer-session`/`x-cart-session` already follow for other
 * per-request secrets.
 */
export default async function SignupCompletePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly token?: string }>;
}) {
  const { token } = await searchParams;

  const jar = await cookies();
  const stored = jar.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);

  const result = await resolveCurrentCustomer(jar.get(CUSTOMER_SESSION_COOKIE)?.value);
  if (result.status === "signed-in") redirect("/account");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />

      <Link href="/" className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
        <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t.account.backToShop}
      </Link>

      <Card>
        <CardContent className="flex flex-col gap-6 py-8">
          {token === undefined || token.length === 0 ? (
            <p className="text-destructive text-sm" role="alert">
              {t.account.signup.invalidLink}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {t.account.signup.completeTitle}
                </h1>
                <p className="text-muted-foreground text-sm">{t.account.signup.completeSubtitle}</p>
              </div>
              <SignupCompleteForm token={token} t={t} />
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
