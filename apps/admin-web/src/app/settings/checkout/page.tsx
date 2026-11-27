import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SettingsFrame } from "@/components/settings/settings-frame";
import { CheckoutSettingsForm } from "@/components/settings/checkout-settings-form";
import { fetchCheckoutSettings } from "@/lib/api/checkout-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Wave 2a - Settings → Checkout. Reads the shop's checkout and customer-account settings
 * (`GET /checkout/settings`; defaults and no version when never saved) and saves them with the version
 * it loaded (`POST /checkout/settings`).
 */
export default async function CheckoutSettingsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const copy = t.checkoutSettings;
  const user = await getCurrentUser();
  const result = await fetchCheckoutSettings();

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <SettingsFrame t={t} activeId="checkout">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <header>
            <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
              {copy.back}
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{copy.subtitle}</p>
          </header>

          {result.outcome === "ok" ? (
            <CheckoutSettingsForm settings={result.settings} t={t} />
          ) : (
            <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
              {result.outcome === "unauthorized" ? (
                <LockIcon aria-hidden="true" className="size-4" />
              ) : (
                <AlertTriangleIcon aria-hidden="true" className="size-4" />
              )}
              {result.outcome === "unauthorized" ? copy.unauthorized : copy.loadError}
            </div>
          )}
        </div>
      </SettingsFrame>
    </AppShell>
  );
}
