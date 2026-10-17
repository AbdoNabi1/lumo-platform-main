import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { DomainsView } from "@/components/settings/domains/domains-view";
import { fetchMyDomains } from "@/lib/api/store-domains";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Settings → Domains (Shopify's Domains page): the store's free Morbeh subdomain and the custom
 * domains a merchant connects to it.
 */
export default async function DomainsSettingsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const result = await fetchMyDomains();

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
            {t.domainsPage.back}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t.domainsPage.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t.domainsPage.subtitle}</p>
        </header>

        {result.outcome === "ok" ? (
          <DomainsView domains={result.domains} dnsTarget={result.dnsTarget} t={t} />
        ) : (
          <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
            {result.outcome === "unauthorized" ? (
              <LockIcon aria-hidden="true" className="size-4" />
            ) : (
              <AlertTriangleIcon aria-hidden="true" className="size-4" />
            )}
            {result.outcome === "unauthorized"
              ? t.domainsPage.unauthorized
              : t.domainsPage.loadError}
          </div>
        )}
      </div>
    </AppShell>
  );
}
