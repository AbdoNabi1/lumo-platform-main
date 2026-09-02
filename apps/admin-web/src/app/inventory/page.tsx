import { cookies } from "next/headers";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import {
  CommitReservationForm,
  DeactivateWarehouseForm,
  RegisterWarehouseForm,
  ReleaseReservationForm,
  ReserveStockForm,
  TransferStockForm,
} from "@/components/inventory/inventory-operations-forms";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.5 — the Inventory operations console. Unlike the Product Detail screen's per-warehouse-row
 * receive/adjust forms (`ProductInventoryTable`), reserve/release/commit and transfer are not
 * scoped to a single product's card in a way that reads well inline — transfer in particular needs
 * two warehouse ids at once. This screen has no read/list backing it at all
 * (`docs/plans/BLOCKERS.md`'s T5.5 entry: no `GET /warehouses` route exists in this codebase), so
 * it renders as four independent sections of self-contained forms, not a data table.
 */
export default async function InventoryPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="inventory" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">{t.inventoryPage.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t.inventoryPage.subtitle}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t.inventoryPage.registerWarehouseTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <RegisterWarehouseForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.inventoryPage.deactivateWarehouseTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <DeactivateWarehouseForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.inventoryPage.transferTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <TransferStockForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.inventoryPage.reservationsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <ReserveStockForm t={t} />
            <ReleaseReservationForm t={t} />
            <CommitReservationForm t={t} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
