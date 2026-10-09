import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PaymentMethodsForm } from "@/components/settings/payment-methods-form";
import { fetchPaymentSettings } from "@/lib/api/payments";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Plan 3A — Settings → Payments. Lists every payment method the platform registers with a switch,
 * and saves which ones the storefront offers (`PUT /payments/settings`). The page never sees a
 * credential: the settings read has no field a secret could occupy.
 */
export default async function PaymentSettingsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const result = await fetchPaymentSettings();

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
            {t.paymentSettings.back}
          </Link>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">{t.paymentSettings.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.paymentSettings.subtitle}</p>
        </header>

        {result.outcome === "ok" ? (
          <PaymentMethodsForm settings={result.settings} t={t} />
        ) : (
          <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
            {result.outcome === "unauthorized" ? (
              <LockIcon aria-hidden="true" className="size-4" />
            ) : (
              <AlertTriangleIcon aria-hidden="true" className="size-4" />
            )}
            {result.outcome === "unauthorized"
              ? t.paymentSettings.unauthorized
              : t.paymentSettings.loadError}
          </div>
        )}
      </div>
    </AppShell>
  );
}
