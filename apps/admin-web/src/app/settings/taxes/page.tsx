import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RegionsView } from "@/components/settings/taxes/regions-view";
import { TaxFlagsForm } from "@/components/settings/taxes/tax-flags-form";
import { fetchTaxSettings } from "@/lib/api/taxes";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Plan 3C — Settings → Taxes and duties (Shopify): whether prices include tax, whether shipping is
 * taxed, and the countries (with province overrides) where tax is collected. With no region the tax
 * at checkout is zero.
 */
export default async function TaxSettingsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const result = await fetchTaxSettings();

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header>
          <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
            {t.taxSettings.back}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t.taxSettings.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t.taxSettings.subtitle}</p>
        </header>

        {result.outcome === "ok" ? (
          <>
            <TaxFlagsForm
              pricesIncludeTax={result.settings.pricesIncludeTax}
              chargeTaxOnShipping={result.settings.chargeTaxOnShipping}
              t={t}
            />
            <RegionsView regions={result.settings.regions} t={t} locale={locale} />
          </>
        ) : (
          <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
            {result.outcome === "unauthorized" ? (
              <LockIcon aria-hidden="true" className="size-4" />
            ) : (
              <AlertTriangleIcon aria-hidden="true" className="size-4" />
            )}
            {result.outcome === "unauthorized"
              ? t.taxSettings.unauthorized
              : t.taxSettings.loadError}
          </div>
        )}
      </div>
    </AppShell>
  );
}
