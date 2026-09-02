import { mutateAdminApi, type MutationResult } from "./client";

/**
 * T5.5 — the 8 Inventory/Warehouse write routes (`admin-routes.ts` lines ~1503-1581). Every one of
 * them delegates through `InventoryAdminController`/its own `warehouse` dep
 * (`apps/admin/src/interfaces/inventory.admin-controller.ts`) straight to `present(await
 * useCase.execute(input), status)` (`services/inventory/src/interfaces/inventory.controller.ts`,
 * `warehouse.controller.ts`) — no DTO mapping step anywhere in the chain. Same `isUnknown` pattern
 * `lib/api/products.ts`'s T5.1 write functions and `lib/api/fulfillment.ts`'s T5.4 write functions
 * already use for the identical shape: every function below reads nothing off the response body,
 * only that the call succeeded. Callers `revalidatePath` the screens that read this data afterwards
 * (`ProductInventoryCard`, via `fetchProductInventory` in this same directory), never trusting this
 * response for anything beyond "did it succeed."
 *
 * There is no `GET /warehouses` (or any warehouse list) route in this codebase — see
 * `docs/plans/BLOCKERS.md`'s T5.5 entry. Every `warehouseId`/`sourceWarehouseId`/
 * `destinationWarehouseId` parameter below is therefore a plain operator-typed string, not resolved
 * against a picker, same fallback T5.1's brand/category fields used.
 */
function isUnknown(_value: unknown): _value is unknown {
  return true;
}

export interface ReceiveStockInput {
  readonly productId: string;
  readonly warehouseId: string;
  readonly quantity: number;
}

/** `POST /inventory/receive` (`idempotent: true`, `inventory:receive`). */
export function receiveStock(
  input: ReceiveStockInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/inventory/receive",
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

export interface AdjustStockInput {
  readonly productId: string;
  readonly warehouseId: string;
  readonly onHand: number;
}

/** `POST /inventory/adjust` (`idempotent: true`, `inventory:adjust`). */
export function adjustStock(
  input: AdjustStockInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/inventory/adjust",
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

export interface ReserveStockInput {
  readonly productId: string;
  readonly warehouseId: string;
  readonly quantity: number;
  readonly reference: string;
}

/**
 * `POST /inventory/reserve` (`idempotent: false`, `inventory:reserve`). `mutateAdminApi` always
 * sends the `Idempotency-Key` header when a key is passed, regardless of the route's own
 * `idempotent` flag (see `lib/api/client.ts`) — the caller still mints exactly one key per submit
 * per this app's own rule; the backend simply won't dedupe replays by it for this route.
 */
export function reserveStock(
  input: ReserveStockInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/inventory/reserve",
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

export interface ReleaseReservationInput {
  readonly productId: string;
  readonly warehouseId: string;
  readonly reservationId: string;
}

/** `POST /inventory/release` (`idempotent: true`, `inventory:release`). */
export function releaseReservation(
  input: ReleaseReservationInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/inventory/release",
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

export interface CommitReservationInput {
  readonly productId: string;
  readonly warehouseId: string;
  readonly reservationId: string;
}

/** `POST /inventory/commit` (`idempotent: true`, `inventory:commit`). */
export function commitReservation(
  input: CommitReservationInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/inventory/commit",
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

export interface TransferStockInput {
  readonly productId: string;
  readonly sourceWarehouseId: string;
  readonly destinationWarehouseId: string;
  readonly quantity: number;
}

/**
 * `POST /inventory/transfer` (`idempotent: false`, `inventory:transfer`). Same `Idempotency-Key`
 * note as `reserveStock` above.
 */
export function transferStock(
  input: TransferStockInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/inventory/transfer",
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

export interface RegisterWarehouseInput {
  readonly code: string;
  readonly name: string;
}

/** `POST /warehouses` (`idempotent: true`, `warehouse:register`). */
export function registerWarehouse(
  input: RegisterWarehouseInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/warehouses",
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/** `POST /warehouses/:warehouseId/deactivate` (`idempotent: true`, `warehouse:deactivate`, no body). */
export function deactivateWarehouse(
  warehouseId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/warehouses/${encodeURIComponent(warehouseId)}/deactivate`,
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}
