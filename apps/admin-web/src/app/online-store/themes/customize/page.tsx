import { cookies } from "next/headers";
import { CustomizeEditor } from "@/components/online-store/customize-editor";
import type { MenuChoice } from "@/components/online-store/customize-panels";
import type { StaffRole } from "@/components/online-store/theme-card";
import { fetchMenus, fetchPreferences, fetchThemeState } from "@/lib/api/online-store";
import { fetchStoreSettings } from "@/lib/api/store-settings";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { menuDisplayTitle } from "@/lib/online-store/menu-copy";

/** Full-screen editor outside AppShell (spec 1.11). Middleware already requires operator. */
export default async function CustomizePage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [session, theme, prefs, menuList, storeSettings] = await Promise.all([
    readSession(),
    fetchThemeState(),
    fetchPreferences(),
    fetchMenus(),
    fetchStoreSettings(),
  ]);
  const role: StaffRole = highestRole(session?.roles ?? []) ?? "viewer";
  if (theme.outcome !== "ok")
    return (
      <p role="alert" className="text-destructive p-6 text-sm">
        {t.onlineStoreThemes.loadError}
      </p>
    );
  // The header and footer selects: the shop's menus, or the two defaults when the list failed.
  const menus: MenuChoice[] =
    menuList.outcome === "ok"
      ? menuList.data.map((menu) => ({ handle: menu.handle, title: menuDisplayTitle(t, menu) }))
      : [
          { handle: "main-menu", title: t.onlineStoreNavigation.defaultMain },
          { handle: "footer", title: t.onlineStoreNavigation.defaultFooter },
        ];
  // A store when the API predates site types; null (offer no lead form) when the read failed.
  const siteType =
    storeSettings.outcome === "ok" ? (storeSettings.settings.siteType ?? "store") : null;
  return (
    <CustomizeEditor
      t={t}
      locale={locale}
      state={theme.data}
      role={role}
      storeName={prefs.outcome === "ok" ? prefs.data.storeName : ""}
      menus={menus}
      siteType={siteType}
    />
  );
}
