import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { AuthForm } from "@/components/auth-form";
import { SiteHeader } from "@/components/site-header";
import { CUSTOMER_SESSION_COOKIE, resolveCurrentCustomer } from "@/lib/customer-session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";

/**
 * Create-account page (T5.17 Part A). Same already-signed-in redirect as the sign-in page, and for
 * the same reason: it is a real server-side session validation, not a cookie-presence check.
 */
export default async function AccountRegisterPage() {
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
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{t.account.register.title}</h1>
            <p className="text-muted-foreground text-sm">{t.account.register.subtitle}</p>
          </div>
          <AuthForm mode="register" t={t} />
        </CardContent>
      </Card>
    </main>
  );
}
