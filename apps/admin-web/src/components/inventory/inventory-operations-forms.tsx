"use client";

import { useActionState, useId } from "react";
import { Button, Input, Label } from "@platform/ui";
import {
  commitReservationAction,
  deactivateWarehouseAction,
  registerWarehouseAction,
  releaseReservationAction,
  reserveStockAction,
  transferStockAction,
} from "@/app/inventory/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * T5.5 — the Inventory operations console's 6 independent forms (`app/inventory/page.tsx`). Each
 * form owns its own `useActionState` and its own success/error feedback — this screen has no
 * read/list backing it (`docs/plans/BLOCKERS.md`'s T5.5 entry: no `GET /warehouses` route exists),
 * so it is a pure operations console, not a shared table, same discipline the task brief calls for.
 * Every `warehouseId`/`productId`/`sourceWarehouseId`/`destinationWarehouseId` field below is a
 * plain text input for the same reason — no picker exists to back it.
 */

function FormError({ state }: { readonly state: FormState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="text-destructive text-xs">
      {state.message}
    </p>
  );
}

function FormSuccess({ state, t }: { readonly state: FormState; readonly t: Dictionary }) {
  if (state.status !== "success") return null;
  return (
    <p role="status" className="text-muted-foreground text-xs">
      {t.productWriteCommon.saved}
    </p>
  );
}

export function RegisterWarehouseForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(registerWarehouseAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-code`} className="text-xs">
            {t.inventoryPage.warehouseCodeLabel}
          </Label>
          <Input
            id={`${formId}-code`}
            name="code"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["code"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-name`} className="text-xs">
            {t.inventoryPage.warehouseNameLabel}
          </Label>
          <Input
            id={`${formId}-name`}
            name="name"
            className="h-9 w-56 text-sm"
            aria-invalid={fieldErrors["name"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.inventoryPage.registering : t.inventoryPage.register}
        </Button>
      </div>
      <FormError state={state} />
      <FormSuccess state={state} t={t} />
    </form>
  );
}

export function DeactivateWarehouseForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(deactivateWarehouseAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-warehouseId`} className="text-xs">
            {t.inventoryPage.warehouseIdLabel}
          </Label>
          <Input
            id={`${formId}-warehouseId`}
            name="warehouseId"
            className="h-9 w-56 text-sm"
            aria-invalid={fieldErrors["warehouseId"] !== undefined || undefined}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          variant="destructive"
          loading={isPending}
          disabled={isPending}
        >
          {isPending ? t.inventoryPage.deactivating : t.inventoryPage.deactivate}
        </Button>
      </div>
      <FormError state={state} />
      <FormSuccess state={state} t={t} />
    </form>
  );
}

export function TransferStockForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(transferStockAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-productId`} className="text-xs">
            {t.inventoryPage.productIdLabel}
          </Label>
          <Input
            id={`${formId}-productId`}
            name="productId"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["productId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-sourceWarehouseId`} className="text-xs">
            {t.inventoryPage.sourceWarehouseIdLabel}
          </Label>
          <Input
            id={`${formId}-sourceWarehouseId`}
            name="sourceWarehouseId"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["sourceWarehouseId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-destinationWarehouseId`} className="text-xs">
            {t.inventoryPage.destinationWarehouseIdLabel}
          </Label>
          <Input
            id={`${formId}-destinationWarehouseId`}
            name="destinationWarehouseId"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["destinationWarehouseId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-quantity`} className="text-xs">
            {t.inventoryPage.quantityLabel}
          </Label>
          <Input
            id={`${formId}-quantity`}
            name="quantity"
            inputMode="numeric"
            className="h-9 w-24 text-sm"
            aria-invalid={fieldErrors["quantity"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.inventoryPage.transferring : t.inventoryPage.transfer}
        </Button>
      </div>
      <FormError state={state} />
      <FormSuccess state={state} t={t} />
    </form>
  );
}

export function ReserveStockForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(reserveStockAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t.inventoryPage.reserveTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-productId`} className="text-xs">
            {t.inventoryPage.productIdLabel}
          </Label>
          <Input
            id={`${formId}-productId`}
            name="productId"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["productId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-warehouseId`} className="text-xs">
            {t.inventoryPage.warehouseIdLabel}
          </Label>
          <Input
            id={`${formId}-warehouseId`}
            name="warehouseId"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["warehouseId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-quantity`} className="text-xs">
            {t.inventoryPage.quantityLabel}
          </Label>
          <Input
            id={`${formId}-quantity`}
            name="quantity"
            inputMode="numeric"
            className="h-9 w-24 text-sm"
            aria-invalid={fieldErrors["quantity"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-reference`} className="text-xs">
            {t.inventoryPage.referenceLabel}
          </Label>
          <Input
            id={`${formId}-reference`}
            name="reference"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["reference"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.inventoryPage.reserving : t.inventoryPage.reserve}
        </Button>
      </div>
      <FormError state={state} />
      <FormSuccess state={state} t={t} />
    </form>
  );
}

export function ReleaseReservationForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(releaseReservationAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t.inventoryPage.releaseTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-productId`} className="text-xs">
            {t.inventoryPage.productIdLabel}
          </Label>
          <Input
            id={`${formId}-productId`}
            name="productId"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["productId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-warehouseId`} className="text-xs">
            {t.inventoryPage.warehouseIdLabel}
          </Label>
          <Input
            id={`${formId}-warehouseId`}
            name="warehouseId"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["warehouseId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-reservationId`} className="text-xs">
            {t.inventoryPage.reservationIdLabel}
          </Label>
          <Input
            id={`${formId}-reservationId`}
            name="reservationId"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["reservationId"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.inventoryPage.releasing : t.inventoryPage.release}
        </Button>
      </div>
      <FormError state={state} />
      <FormSuccess state={state} t={t} />
    </form>
  );
}

export function CommitReservationForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(commitReservationAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t.inventoryPage.commitTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-productId`} className="text-xs">
            {t.inventoryPage.productIdLabel}
          </Label>
          <Input
            id={`${formId}-productId`}
            name="productId"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["productId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-warehouseId`} className="text-xs">
            {t.inventoryPage.warehouseIdLabel}
          </Label>
          <Input
            id={`${formId}-warehouseId`}
            name="warehouseId"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["warehouseId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-reservationId`} className="text-xs">
            {t.inventoryPage.reservationIdLabel}
          </Label>
          <Input
            id={`${formId}-reservationId`}
            name="reservationId"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["reservationId"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.inventoryPage.committing : t.inventoryPage.commit}
        </Button>
      </div>
      <FormError state={state} />
      <FormSuccess state={state} t={t} />
    </form>
  );
}
