import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { WarehouseDto } from "@/lib/api/inventory";
import type { Dictionary } from "@/messages/en";
import {
  CommitReservationForm,
  ReleaseReservationForm,
  ReserveStockForm,
  TransferStockForm,
} from "./inventory-operations-forms";
import { LocationsCard } from "./locations-card";

type Locations =
  | { readonly outcome: "ok"; readonly items: readonly WarehouseDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error" };

/**
 * Plan 2B-3 — the Inventory page body. The Locations card comes first (by name, Shopify-style); the
 * tools that still ask for ids by hand — stock transfer and reservations — sit under a collapsed
 * "Advanced" section. A locations read that fails shows its own state and leaves Advanced in place.
 */
export function InventoryView({
  t,
  warehouses,
}: {
  readonly t: Dictionary;
  readonly warehouses: Locations;
}) {
  const copy = t.inventoryPage;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{copy.subtitle}</p>
      </div>

      {warehouses.outcome === "ok" ? (
        <LocationsCard locations={warehouses.items} t={t} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{copy.locationsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground flex items-center gap-2 text-sm">
            {warehouses.outcome === "unauthorized" ? (
              <LockIcon aria-hidden="true" className="size-4" />
            ) : (
              <AlertTriangleIcon aria-hidden="true" className="size-4" />
            )}
            <p role="note">
              {warehouses.outcome === "unauthorized"
                ? copy.locationsUnauthorized
                : copy.locationsError}
            </p>
          </CardContent>
        </Card>
      )}

      <details className="group flex flex-col gap-6">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm font-medium">
          {copy.advanced}
        </summary>
        <div className="mt-6 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{copy.transferTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <TransferStockForm t={t} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{copy.reservationsTitle}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <ReserveStockForm t={t} />
              <ReleaseReservationForm t={t} />
              <CommitReservationForm t={t} />
            </CardContent>
          </Card>
        </div>
      </details>
    </div>
  );
}
