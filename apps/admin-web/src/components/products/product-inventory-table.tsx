"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { CheckIcon } from "lucide-react";
import {
  Button,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { adjustStockAction, receiveStockAction } from "@/app/inventory/actions";
import type { FormState } from "@/lib/api/mutation";
import type { ProductInventoryRowDto } from "@/lib/api/products";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

type RowAction = "receive" | "adjust";

/**
 * T5.5 — the interactive half of `ProductInventoryCard` (kept in its own client-component file
 * since the card itself is an async Server Component that fetches its own data; a file can't be
 * both). Renders the read-only rows plus, per row, "Receive"/"Adjust" buttons that expand into an
 * inline form — same pattern as `ProductVariantsCard`'s `VariantEditRow` (T5.1). Below the table, a
 * standalone "receive at a warehouse" form covers both topping up an existing row and receiving the
 * very first stock for a warehouse this product has no row for yet (including the empty-inventory
 * state) — `receive` is what creates the underlying item, so there is no separate "add row" action.
 */
export function ProductInventoryTable({
  productId,
  rows,
  t,
}: {
  readonly productId: string;
  readonly rows: readonly ProductInventoryRowDto[];
  readonly t: Dictionary;
}) {
  return (
    <div className="flex flex-col gap-4">
      {rows.length > 0 ? (
        <Table aria-label={t.productDetail.inventory}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.productDetail.inventoryColumns.warehouse}</TableHead>
              <TableHead className="text-end">{t.productDetail.inventoryColumns.onHand}</TableHead>
              <TableHead className="text-end">
                {t.productDetail.inventoryColumns.reserved}
              </TableHead>
              <TableHead className="text-end">
                {t.productDetail.inventoryColumns.available}
              </TableHead>
              <TableHead className="text-end">{t.inventoryRowForm.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <InventoryRow key={row.warehouseId} productId={productId} row={row} t={t} />
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground px-4 pt-4 text-sm sm:px-5">
          {t.productDetail.noInventory}
        </p>
      )}

      <div className="px-4 pb-4 sm:px-5">
        <ReceiveNewStockForm productId={productId} t={t} />
      </div>
    </div>
  );
}

function InventoryRow({
  productId,
  row,
  t,
}: {
  readonly productId: string;
  readonly row: ProductInventoryRowDto;
  readonly t: Dictionary;
}) {
  const [active, setActive] = useState<RowAction | null>(null);

  const toggle = (action: RowAction) => setActive((current) => (current === action ? null : action));

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-xs">{row.warehouseId}</TableCell>
        <TableCell className="text-end tabular-nums">{row.onHand}</TableCell>
        <TableCell className="text-end tabular-nums">{row.reserved}</TableCell>
        <TableCell className="text-end font-medium tabular-nums">{row.available}</TableCell>
        <TableCell className="text-end">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => toggle("receive")}>
              {t.inventoryRowForm.receive}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => toggle("adjust")}>
              {t.inventoryRowForm.adjust}
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {active === "receive" && (
        <TableRow>
          <TableCell colSpan={5}>
            <ReceiveRowForm
              productId={productId}
              warehouseId={row.warehouseId}
              t={t}
              onDone={() => setActive(null)}
            />
          </TableCell>
        </TableRow>
      )}
      {active === "adjust" && (
        <TableRow>
          <TableCell colSpan={5}>
            <AdjustRowForm
              productId={productId}
              warehouseId={row.warehouseId}
              currentOnHand={row.onHand}
              t={t}
              onDone={() => setActive(null)}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ReceiveRowForm({
  productId,
  warehouseId,
  t,
  onDone,
}: {
  readonly productId: string;
  readonly warehouseId: string;
  readonly t: Dictionary;
  readonly onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(receiveStockAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  // A successful receive closes the inline form — the refreshed row (via `revalidatePath` in the
  // action) then renders the updated on-hand/available counts in its place, same as
  // `ProductVariantsCard`'s `VariantEditRow`.
  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state.status, onDone]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="warehouseId" value={warehouseId} />
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${formId}-quantity`} className="text-xs">
          {t.inventoryRowForm.quantity}
        </Label>
        <Input
          id={`${formId}-quantity`}
          name="quantity"
          inputMode="numeric"
          className="h-8 w-24 text-xs"
          aria-invalid={fieldErrors["quantity"] !== undefined || undefined}
        />
      </div>
      <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
        {isPending ? t.inventoryRowForm.receiving : t.inventoryRowForm.confirmReceive}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onDone}>
        {t.inventoryRowForm.cancel}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive w-full text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

function AdjustRowForm({
  productId,
  warehouseId,
  currentOnHand,
  t,
  onDone,
}: {
  readonly productId: string;
  readonly warehouseId: string;
  readonly currentOnHand: number;
  readonly t: Dictionary;
  readonly onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(adjustStockAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state.status, onDone]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="warehouseId" value={warehouseId} />
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${formId}-onHand`} className="text-xs">
          {t.inventoryRowForm.onHand}
        </Label>
        <Input
          id={`${formId}-onHand`}
          name="onHand"
          inputMode="numeric"
          defaultValue={String(currentOnHand)}
          className="h-8 w-24 text-xs"
          aria-invalid={fieldErrors["onHand"] !== undefined || undefined}
        />
      </div>
      <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
        {isPending ? t.inventoryRowForm.adjusting : t.inventoryRowForm.confirmAdjust}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onDone}>
        {t.inventoryRowForm.cancel}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive w-full text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

function ReceiveNewStockForm({
  productId,
  t,
}: {
  readonly productId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(receiveStockAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="productId" value={productId} />
      <h3 className="text-sm font-medium">{t.inventoryRowForm.receiveNewTitle}</h3>
      <p className="text-muted-foreground text-xs">{t.inventoryRowForm.warehouseIdHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-warehouseId`} className="text-xs">
            {t.inventoryRowForm.warehouseId}
          </Label>
          <Input
            id={`${formId}-warehouseId`}
            name="warehouseId"
            className="h-8 w-40 text-xs"
            aria-invalid={fieldErrors["warehouseId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-quantity`} className="text-xs">
            {t.inventoryRowForm.quantity}
          </Label>
          <Input
            id={`${formId}-quantity`}
            name="quantity"
            inputMode="numeric"
            className="h-8 w-24 text-xs"
            aria-invalid={fieldErrors["quantity"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.inventoryRowForm.receiving : t.inventoryRowForm.confirmReceive}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="text-muted-foreground flex items-center gap-1 text-xs">
          <CheckIcon aria-hidden="true" className="size-3.5" />
          {t.productWriteCommon.saved}
        </p>
      )}
    </form>
  );
}
