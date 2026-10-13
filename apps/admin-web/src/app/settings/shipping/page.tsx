import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ZonesView } from "@/components/settings/shipping/zones-view";
import { fetchShippingZones } from "@/lib/api/shipping-zones";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { homeCountryFor } from "@/lib/shipping/quick-setup";

/**
 * Plan 3C — Settings → Shipping and delivery (Shopify's "General shipping rates"): the zones the shop
 * ships to, with governorates, and the rates customers choose from at checkout. Prices and weights are
 * shown in the store currency and weight unit from Settings → General.
 */
export default async function ShippingSettingsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const [result, settings] = await Promise.all([fetchShippingZones(), storeSettingsOrDefaults()]);

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header>
          <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
            {t.shippingSettings.back}
          </Link>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">{t.shippingSettings.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.shippingSettings.subtitle}</p>
        </header>

        {result.outcome === "ok" ? (
          <ZonesView
            zones={result.zones}
            currency={settings.currency}
            weightUnit={settings.weightUnit}
            homeCountry={homeCountryFor(settings.currency)}
            t={t}
            locale={locale}
          />
        ) : (
          <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
            {result.outcome === "unauthorized" ? (
              <LockIcon aria-hidden="true" className="size-4" />
            ) : (
              <AlertTriangleIcon aria-hidden="true" className="size-4" />
            )}
            {result.outcome === "unauthorized"
              ? t.shippingSettings.unauthorized
              : t.shippingSettings.loadError}
          </div>
        )}
      </div>
    </AppShell>
  );
}
