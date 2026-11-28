import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AdPlatformsForm } from "@/components/settings/ad-platforms-form";
import { SettingsFrame } from "@/components/settings/settings-frame";
import { fetchAdPlatforms } from "@/lib/api/ad-platforms";
import { fetchStoreSettings } from "@/lib/api/store-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Lead site D1 - Settings → Ad platforms: one card per platform (Meta, TikTok, Snapchat, GA4, Google
 * Ads) with its ids, a write-only token, the on/off switch and its status. The site type (fixed at
 * sign-up) says which events the site sends; it is read beside the connections and never blocks them.
 */
export default async function AdPlatformsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const copy = t.adPlatformsSettings;
  const user = await getCurrentUser();
  const [result, store] = await Promise.all([fetchAdPlatforms(), fetchStoreSettings()]);
  const siteType = store.outcome === "ok" ? store.settings.siteType : undefined;

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <SettingsFrame t={t} activeId="ad-platforms">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <header>
            <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
              {copy.back}
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{copy.subtitle}</p>
          </header>

          {result.outcome === "ok" ? (
            <AdPlatformsForm views={result.items} siteType={siteType} t={t} />
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
