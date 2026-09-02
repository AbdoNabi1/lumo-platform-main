import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { SeoSubNav } from "@/components/seo/seo-sub-nav";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.9b — the SEO shell shared by all four `/seo/*` screens (profiles, redirects, sitemaps,
 * robots policies): the `AppShell` chrome, read once here rather than per-page (same reasoning as
 * T3.1's `SecurityLayout`), plus the sub-navigation. No frontend existed for this domain before
 * this task.
 */
export default async function SeoLayout({ children }: { readonly children: ReactNode }) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="seo" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <SeoSubNav t={t} />
        {children}
      </div>
    </AppShell>
  );
}
