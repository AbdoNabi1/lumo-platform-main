import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { InventoryView } from "@/components/inventory/inventory-view";
import { fetchWarehouses } from "@/lib/api/inventory";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * The Inventory screen. Plan 2B-3: the shop's locations are listed by name (`GET /warehouses`) with
 * an Add location form and a Deactivate button; the tools that still take ids by hand — transfer
 * and reservations (T5.5) — live under a collapsed "Advanced" section.
 */
export default async function InventoryPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const warehouses = await fetchWarehouses();

  return (
    <AppShell t={t} locale={locale} activeNavId="inventory" user={user}>
      <InventoryView t={t} warehouses={warehouses} />
    </AppShell>
  );
}
