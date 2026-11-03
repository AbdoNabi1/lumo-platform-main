import { cookies } from "next/headers";
import { CustomizeEditor } from "@/components/online-store/customize-editor";
import type { StaffRole } from "@/components/online-store/theme-card";
import { fetchPreferences, fetchThemeState } from "@/lib/api/online-store";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** Full-screen editor outside AppShell (spec 1.11). Middleware already requires operator. */
export default async function CustomizePage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [session, theme, prefs] = await Promise.all([
    readSession(),
    fetchThemeState(),
    fetchPreferences(),
  ]);
  const role: StaffRole = highestRole(session?.roles ?? []) ?? "viewer";
  if (theme.outcome !== "ok")
    return (
      <p role="alert" className="text-destructive p-6 text-sm">
        {t.onlineStoreThemes.loadError}
      </p>
    );
  return (
    <CustomizeEditor
      t={t}
      locale={locale}
      state={theme.data}
      role={role}
      storeName={prefs.outcome === "ok" ? prefs.data.storeName : ""}
    />
  );
}
