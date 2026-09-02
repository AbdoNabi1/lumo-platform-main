import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { SecuritySubNav } from "@/components/security/security-sub-nav";
import { SecurityTenantFilter } from "@/components/security/security-tenant-filter";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T3.1 — the Security Console shell shared by all seven `/security/*` screens: the `AppShell`
 * chrome (read once here rather than per-page, since it's identical across every screen), the
 * sub-navigation, and the one filter every console read model accepts (`?tenantRef=`, see
 * `SecurityTenantFilter`). Admin-only (`middleware.ts`'s `ROUTE_ROLE_REQUIREMENTS`) — read-only,
 * no write controls (Phase 5 territory; see the brief).
 */
export default async function SecurityLayout({ children }: { readonly children: ReactNode }) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="security" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <div className="flex flex-col gap-3">
          <SecuritySubNav t={t} />
          <div className="flex justify-end">
            <SecurityTenantFilter t={t} />
          </div>
        </div>
        {children}
      </div>
    </AppShell>
  );
}
