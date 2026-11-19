import type { ShipOutcome, ShipResult } from "./ports";

export const BULK_BUDGET_MS = 55_000;
export const BULK_ORDER_RESERVE_MS = 25_000;
export interface BulkShipResult {
  readonly shipped: readonly ShipResult[];
  readonly failed: readonly {
    readonly orderId: string;
    readonly code: string;
    readonly reason?: string;
    readonly orderNumber?: string;
    readonly attempted: boolean;
  }[];
}
export async function shipInBulk(
  ship: (orderId: string, idempotencyKey: string) => Promise<ShipOutcome>,
  input: { readonly orderIds: readonly string[]; readonly idempotencyKey: string },
  nowMs: () => number,
): Promise<BulkShipResult> {
  const started = nowMs();
  const shipped: ShipResult[] = [];
  const failed: BulkShipResult["failed"][number][] = [];
  for (const [index, orderId] of input.orderIds.entries()) {
    if (nowMs() - started > BULK_BUDGET_MS - BULK_ORDER_RESERVE_MS) {
      for (const rest of input.orderIds.slice(index))
        failed.push({ orderId: rest, code: "CARRIER_TIMEOUT", attempted: false });
      break;
    }
    try {
      const outcome = await ship(orderId, `${input.idempotencyKey}:${orderId}`);
      if (outcome.ok) shipped.push(outcome.value);
      else
        failed.push({
          orderId,
          code: outcome.code,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
          ...(outcome.orderNumber ? { orderNumber: outcome.orderNumber } : {}),
          attempted: true,
        });
    } catch {
      failed.push({ orderId, code: "CARRIER_UNAVAILABLE", attempted: true });
    }
  }
  return { shipped, failed };
}
