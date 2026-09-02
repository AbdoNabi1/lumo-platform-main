import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

export interface ReturnItemDto {
  readonly orderItemRef: string;
  readonly productRef: string;
  readonly quantity: number;
  readonly reasonCode: string;
  readonly reasonNote: string | null;
  readonly disposition: string | null;
}

export interface ReturnDetailDto {
  readonly id: string;
  readonly orderRef: string;
  readonly status: string;
  readonly items: readonly ReturnItemDto[];
  readonly rmaNumber: string | null;
  readonly approved: boolean | null;
  readonly approvalNote: string | null;
  readonly refundOutcome: string | null;
  readonly refundAmountMinor: number | null;
  readonly refundCurrency: string | null;
}

function isReturnDetailDto(value: unknown): value is ReturnDetailDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export type FetchReturnResult =
  | { readonly outcome: "ok"; readonly returnRequest: ReturnDetailDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches the return request opened for an order, if any (Order Detail screen's Returns panel). */
export async function fetchReturnByOrder(orderId: string): Promise<FetchReturnResult> {
  const result = await getAdminApi(
    `/api/v1/orders/${encodeURIComponent(orderId)}/return`,
    isReturnDetailDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", returnRequest: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

/**
 * T5.3 — the 8 return write routes below (`returns-routes.ts`). None of their handlers map the
 * response through a DTO (each one is a plain `return admin.returns.<x>(...)` — see that file's
 * own doc comment on `toReturnDetailDto` being used only by `getByOrder`), so exactly like
 * `orders.ts`'s 5 non-DTO write functions, every one of these reads nothing off the response body
 * — `isUnknown` only checks the call succeeded. Callers `revalidatePath` the returns detail page
 * afterwards, which re-fetches the real, DTO-mapped state via `fetchReturnByOrder`.
 */
function isUnknown(_value: unknown): _value is unknown {
  return true;
}

function returnPath(returnId: string, suffix: string): string {
  return `/api/v1/returns/${encodeURIComponent(returnId)}${suffix}`;
}

export interface CreateReturnItemInput {
  readonly orderItemRef: string;
  readonly productRef: string;
  readonly quantity: number;
  readonly reasonCode: string;
  readonly reasonNote?: string;
}

export interface CreateReturnInput {
  readonly orderRef: string;
  readonly items: readonly CreateReturnItemInput[];
}

/**
 * Opens a return request for an order's items (`POST /returns`, `idempotent: true`,
 * `returns:create`). The created return is keyed by `orderRef`, not returned here — the caller
 * re-fetches it via `fetchReturnByOrder`, same as every other write below.
 */
export function createReturn(
  input: CreateReturnInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/returns",
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/** Approves or rejects a return request (`POST /returns/:returnId/decision`, `idempotent: true`, `returns:decision`). */
export function decideReturn(
  returnId: string,
  approved: boolean,
  note: string | undefined,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    returnPath(returnId, "/decision"),
    { method: "POST", body: { approved, note }, idempotencyKey },
    isUnknown,
  );
}

/** Generates the RMA number for an approved return (`POST /returns/:returnId/rma`, `idempotent: true`, `returns:rma`). */
export function generateReturnRma(
  returnId: string,
  rmaNumber: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    returnPath(returnId, "/rma"),
    { method: "POST", body: { rmaNumber }, idempotencyKey },
    isUnknown,
  );
}

/**
 * Records the returned package's receipt (`POST /returns/:returnId/receive`, `idempotent: false`,
 * `returns:receive`). `mutateAdminApi` always sends the `Idempotency-Key` header when a key is
 * passed, regardless of the route's own `idempotent` flag (see `lib/api/client.ts`) — the caller
 * still mints exactly one key per submit per this app's own rule; the backend simply won't dedupe
 * replays by it for this route (it is itself replay-safe against Shipping's own callback id).
 */
export function receiveReturnPackage(
  returnId: string,
  source: string,
  callbackId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    returnPath(returnId, "/receive"),
    { method: "POST", body: { source, callbackId }, idempotencyKey },
    isUnknown,
  );
}

/**
 * Records one item's inspection result (`POST /returns/:returnId/inspection`, `idempotent: false`,
 * `returns:inspection`) — one call per item, per the route's own summary. Same `Idempotency-Key`
 * note as `receiveReturnPackage` above.
 */
export function recordReturnInspection(
  returnId: string,
  itemRef: string,
  passed: boolean,
  note: string | undefined,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    returnPath(returnId, "/inspection"),
    { method: "POST", body: { itemRef, passed, note }, idempotencyKey },
    isUnknown,
  );
}

export interface AcceptReturnItemInput {
  readonly orderItemRef: string;
  readonly disposition: string;
}

/** Accepts inspected items with their dispositions (`POST /returns/:returnId/accept`, `idempotent: true`, `returns:accept`). */
export function acceptReturnItems(
  returnId: string,
  items: readonly AcceptReturnItemInput[],
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    returnPath(returnId, "/accept"),
    { method: "POST", body: { items }, idempotencyKey },
    isUnknown,
  );
}

/**
 * Advances a return request to any status its current status's transition table allows (`POST
 * /returns/:returnId/transitions`, `idempotent: true`, `returns:advance`) — the fallback for the
 * transitions with no dedicated action (`lib/return-lifecycle.ts`'s `hasDedicatedActionFrom`).
 */
export function advanceReturn(
  returnId: string,
  toStatus: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    returnPath(returnId, "/transitions"),
    { method: "POST", body: { toStatus }, idempotencyKey },
    isUnknown,
  );
}

export type ReturnResolutionOutcome = "refund" | "replacement" | "repair";

/** Decides the resolution for accepted items (`POST /returns/:returnId/resolution`, `idempotent: true`, `returns:resolution`). */
export function resolveReturn(
  returnId: string,
  outcome: ReturnResolutionOutcome,
  amountMinor: number | undefined,
  currency: string | undefined,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    returnPath(returnId, "/resolution"),
    { method: "POST", body: { outcome, amountMinor, currency }, idempotencyKey },
    isUnknown,
  );
}
