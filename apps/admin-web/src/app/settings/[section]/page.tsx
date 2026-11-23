import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { SETTINGS_NAV_ITEMS } from "@/components/settings/settings-nav";
import { SettingsFrame } from "@/components/settings/settings-frame";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Settings sections Morbeh does not have yet (Shopify's entries without a page here). Static
 * settings routes (`general`, `billing`, …) take precedence over this dynamic one, so only the
 * unavailable ids reach it; anything else is a 404.
 */
export default async function SettingsSectionPage({
  params,
}: {
  readonly params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const item = SETTINGS_NAV_ITEMS.find((entry) => !entry.available && entry.id === section);
  if (item === undefined) notFound();

  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <SettingsFrame t={t} activeId={item.id}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{item.label(t)}</h1>
              <p className="text-muted-foreground text-sm">{t.settingsNav.comingSoon}</p>
              <Link
                href="/settings"
                className="text-foreground inline-flex items-center gap-1 text-sm font-medium hover:underline"
              >
                {t.settingsNav.backToSettings}
                <ChevronRightIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </SettingsFrame>
    </AppShell>
  );
}
