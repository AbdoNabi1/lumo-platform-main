import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StoreSettingsForm } from "@/components/settings/store-settings-form";
import { fetchStoreSettings } from "@/lib/api/store-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Plan 3C — Settings → General: the store's name, contact email, currency, time zone and weight unit
 * (Shopify's Settings → General). The currency is the one every price in the store uses.
 */
export default async function GeneralSettingsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const result = await fetchStoreSettings();

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
            {t.generalSettings.back}
          </Link>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">{t.generalSettings.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.generalSettings.subtitle}</p>
        </header>

        {result.outcome === "ok" ? (
          <StoreSettingsForm settings={result.settings} t={t} locale={locale} />
        ) : (
          <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
            {result.outcome === "unauthorized" ? (
              <LockIcon aria-hidden="true" className="size-4" />
            ) : (
              <AlertTriangleIcon aria-hidden="true" className="size-4" />
            )}
            {result.outcome === "unauthorized"
              ? t.generalSettings.unauthorized
              : t.generalSettings.loadError}
          </div>
        )}
      </div>
    </AppShell>
  );
}
