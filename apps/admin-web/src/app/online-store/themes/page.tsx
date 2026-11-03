import Link from "next/link";
import { cookies } from "next/headers";
import { LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ReleaseHistory } from "@/components/online-store/release-history";
import { ThemeCard, type StaffRole } from "@/components/online-store/theme-card";
import { fetchAccess, fetchThemeReleases, fetchThemeState } from "@/lib/api/online-store";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Online Store → Themes (Shopify's Themes page, spec 1.11). Viewer-readable; Customize needs an
 * operator; Publish and Restore need an admin. The role only decides what is offered — the API
 * enforces every permission itself.
 */
export default async function OnlineStoreThemesPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [user, session, theme, releases, access] = await Promise.all([
    getCurrentUser(),
    readSession(),
    fetchThemeState(),
    fetchThemeReleases(),
    fetchAccess(),
  ]);
  const role: StaffRole = highestRole(session?.roles ?? []) ?? "viewer";
  return (
    <AppShell t={t} locale={locale} activeNavId="online-store-themes" user={user}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t.onlineStoreThemes.title}</h1>
        {access.outcome === "ok" && access.data.locked ? (
          <div
            role="status"
            className="bg-warning-subtle text-warning-foreground flex flex-wrap items-center gap-2 rounded-lg px-4 py-3 text-sm"
          >
            <LockIcon aria-hidden="true" className="size-4" />
            {t.onlineStoreThemes.lockedBanner}{" "}
            <Link href="/online-store/preferences" className="underline">
              {t.onlineStoreThemes.lockedLink}
            </Link>
          </div>
        ) : null}
        {theme.outcome === "ok" ? (
          <>
            <ThemeCard t={t} locale={locale} state={theme.data} role={role} />
            <ReleaseHistory
              t={t}
              locale={locale}
              releases={releases.outcome === "ok" ? releases.data : []}
              version={theme.data.version}
              isAdmin={role === "admin"}
            />
          </>
        ) : (
          <p role="alert" className="text-destructive text-sm">
            {t.onlineStoreThemes.loadError}
          </p>
        )}
      </div>
    </AppShell>
  );
}
