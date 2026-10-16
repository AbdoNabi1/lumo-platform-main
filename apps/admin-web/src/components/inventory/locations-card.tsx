"use client";

import { useActionState, useId } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@platform/ui";
import { addLocationAction, deactivateLocationAction } from "@/app/inventory/actions";
import type { WarehouseDto } from "@/lib/api/inventory";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Plan 2B-3 — the shop's stock locations by name, as in Shopify: each one with its code (muted) and
 * whether it is active, an "Add location" form that asks for a name only (the code is derived), and a
 * Deactivate button on active rows that asks first. Ids travel only in a hidden field.
 */
export function LocationsCard({
  locations,
  t,
}: {
  readonly locations: readonly WarehouseDto[];
  readonly t: Dictionary;
}) {
  const copy = t.inventoryPage;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.locationsTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {locations.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.noLocations}</p>
        ) : (
          <ul className="divide-border border-border divide-y rounded-lg border">
            {locations.map((location) => (
              <LocationRow key={location.id} location={location} t={t} />
            ))}
          </ul>
        )}
        <AddLocationForm t={t} />
      </CardContent>
    </Card>
  );
}

function LocationRow({ location, t }: { readonly location: WarehouseDto; readonly t: Dictionary }) {
  const copy = t.inventoryPage;
  const [state, formAction, isPending] = useActionState(deactivateLocationAction, INITIAL_STATE);
  const active = location.status === "active";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{location.name}</span>
        <span className="text-muted-foreground text-xs">{location.code}</span>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant={active ? "success" : "neutral"}>
          {active ? copy.statusActive : copy.statusInactive}
        </Badge>
        {active && (
          <form
            action={formAction}
            onSubmit={(event) => {
              if (!window.confirm(copy.confirmDeactivate)) event.preventDefault();
            }}
          >
            <input type="hidden" name="warehouseId" value={location.id} />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              loading={isPending}
              disabled={isPending}
            >
              {isPending ? copy.deactivating : copy.deactivate}
            </Button>
          </form>
        )}
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive w-full text-xs">
          {state.message}
        </p>
      )}
    </li>
  );
}

function AddLocationForm({ t }: { readonly t: Dictionary }) {
  const copy = t.inventoryPage;
  const [state, formAction, isPending] = useActionState(addLocationAction, INITIAL_STATE);
  const fieldId = useId();
  const nameError = state.status === "error" ? state.fieldErrors["name"] : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldId}-name`} className="text-xs">
            {copy.locationNameLabel}
          </Label>
          <Input
            id={`${fieldId}-name`}
            name="name"
            className="h-9 w-64 text-sm"
            aria-invalid={nameError !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? copy.addingLocation : copy.addLocation}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="text-muted-foreground text-xs">
          {t.productWriteCommon.saved}
        </p>
      )}
    </form>
  );
}
