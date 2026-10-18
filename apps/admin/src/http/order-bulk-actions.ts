import type { Principal } from "@platform/contracts";
import {
  derivePaymentStatus,
  isOpenOrder,
  type ArchiveOrdersOutput,
  type Order,
} from "@platform/orders";
import type { Paginated } from "@platform/types";
import { logger } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import type { BulkOrderAction } from "../interfaces/bulk-order-actions";
import { fulfillmentStatusesOf } from "./fulfillment-statuses-of";
import { paymentIntentsOfOrders } from "./order-payment-intents";

export type BulkSkipReason =
  | "already_archived"
  | "not_archived"
  | "order_not_open"
  | "fulfillment_already_open"
  | "payment_not_pending"
  | "payment_already_requested"
  | "not_cash_on_delivery";

/** One order's result: ok, skipped (with why) or failed (with the refusing call's message). */
export interface BulkOrderResultDto {
  readonly orderId: string;
  readonly outcome: "ok" | "skipped" | "failed";
  readonly reason?: string;
}

type BulkAdmin = Pick<WiredAdmin, "orders" | "fulfillment" | "payments">;

export interface BulkContext {
  readonly admin: BulkAdmin;
  readonly principal: Principal;
  readonly tenantId: string;
  /** Deduped, 1..50. */
  readonly orderIds: readonly string[];
}

export type BulkOutcome =
  | { readonly ok: true; readonly results: readonly BulkOrderResultDto[] }
  | { readonly ok: false; readonly response: AdminResponse };

export type BulkRunner = (context: BulkContext) => Promise<BulkOutcome>;

const done = (orderId: string): BulkOrderResultDto => ({ orderId, outcome: "ok" });
const skipped = (orderId: string, reason: BulkSkipReason): BulkOrderResultDto => ({
  orderId,
  outcome: "skipped",
  reason,
});
const failed = (orderId: string, reason: string): BulkOrderResultDto => ({
  orderId,
  outcome: "failed",
  reason,
});

const succeeded = (response: AdminResponse) => response.status >= 200 && response.status < 300;

/** The refusing call's message (what the merchant reads in the details list), else its status. */
export function reasonOf(response: AdminResponse): string {
  const body = response.body as { readonly message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : `status ${response.status}`;
}

/**
 * One call per order, one after another (each its own transaction); a throw fails that order only —
 * and is logged (message, action, order — never a request body) so it can be found afterwards.
 */
async function perOrder(
  action: BulkOrderAction,
  tenantId: string,
  orderIds: readonly string[],
  run: (orderId: string) => Promise<BulkOrderResultDto>,
): Promise<BulkOrderResultDto[]> {
  const results: BulkOrderResultDto[] = [];
  for (const orderId of orderIds) {
    try {
      results.push(await run(orderId));
    } catch (error) {
      logger.error("bulk order action failed unexpectedly", {
        action,
        orderId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      results.push(failed(orderId, "unexpected_error"));
    }
  }
  return results;
}

/** The selected orders of this shop, in ONE list read; ids it does not have are simply absent. */
async function loadOrders(
  context: BulkContext,
): Promise<
  | { readonly ok: true; readonly byId: ReadonlyMap<string, Order> }
  | { readonly ok: false; readonly response: AdminResponse }
> {
  const response = await context.admin.orders.listOrders(context.principal, {
    tenantId: context.tenantId,
    ids: context.orderIds,
    first: context.orderIds.length,
  });
  if (response.status !== 200) return { ok: false, response };
  const page = response.body as Paginated<Order>;
  return { ok: true, byId: new Map(page.items.map((order) => [order.id.toString(), order])) };
}

function archiveRunner(archive: boolean): BulkRunner {
  return async ({ admin, principal, tenantId, orderIds }) => {
    const input = { tenantId, orderIds, actorRef: principal.id };
    const response = archive
      ? await admin.orders.archiveOrders(principal, input)
      : await admin.orders.unarchiveOrders(principal, input);
    if (response.status !== 200) return { ok: false, response };
    return {
      ok: true,
      results: (response.body as ArchiveOrdersOutput).results.map((result) => {
        if (result.outcome === "changed") return done(result.orderId);
        if (result.outcome === "unchanged") {
          return skipped(result.orderId, archive ? "already_archived" : "not_archived");
        }
        return failed(result.orderId, "not_found");
      }),
    };
  };
}

/** "Fulfill items": the order page's button — open a fulfillment for every item (spec decision 7). */
const fulfillRunner: BulkRunner = async (context) => {
  const loaded = await loadOrders(context);
  if (!loaded.ok) return loaded;
  const statuses = await fulfillmentStatusesOf(context.admin, context.principal, context.tenantId, [
    ...loaded.byId.keys(),
  ]);
  if (!statuses.ok) return { ok: false, response: statuses.response };
  const results = await perOrder("fulfill", context.tenantId, context.orderIds, async (orderId) => {
    const order = loaded.byId.get(orderId);
    if (order === undefined) return failed(orderId, "not_found");
    if (!isOpenOrder(order.history)) return skipped(orderId, "order_not_open");
    if ((statuses.byOrder.get(orderId) ?? "unfulfilled") !== "unfulfilled") {
      return skipped(orderId, "fulfillment_already_open");
    }
    const response = await context.admin.fulfillment.create(context.principal, {
      tenantId: context.tenantId,
      orderRef: orderId,
      items: order.items.map((item) => ({
        productRef: item.snapshot.productId,
        quantity: item.quantity,
      })),
    });
    return succeeded(response) ? done(orderId) : failed(orderId, reasonOf(response));
  });
  return { ok: true, results };
};

/**
 * "Capture payments": `requestPaymentCapture`, the order page's call. It only acts on an order with no
 * linked payment — checkout orders (cash on delivery, card) link theirs at checkout, where the call
 * would silently do nothing — so those are skipped as `payment_already_requested`.
 */
const capturePaymentsRunner: BulkRunner = async (context) => {
  const loaded = await loadOrders(context);
  if (!loaded.ok) return loaded;
  const results = await perOrder(
    "capture_payments",
    context.tenantId,
    context.orderIds,
    async (orderId) => {
      const order = loaded.byId.get(orderId);
      if (order === undefined) return failed(orderId, "not_found");
      if (!isOpenOrder(order.history)) return skipped(orderId, "order_not_open");
      if (derivePaymentStatus(order.history) !== "pending")
        return skipped(orderId, "payment_not_pending");
      if (order.paymentRef !== undefined) return skipped(orderId, "payment_already_requested");
      const response = await context.admin.orders.requestPaymentCapture(context.principal, {
        tenantId: context.tenantId,
        orderId,
      });
      return succeeded(response) ? done(orderId) : failed(orderId, reasonOf(response));
    },
  );
  return { ok: true, results };
};

/** Intent statuses after which a collection can no longer be confirmed. */
const NOT_COLLECTIBLE = new Set([
  "captured",
  "refunded",
  "partially_refunded",
  "cancelled",
  "expired",
  "closed",
  "failed",
]);

/**
 * "Mark cash as received": `ConfirmCodCollection` for each pending cash-on-delivery payment of THESE
 * orders, with the amount read from the intent server-side — exactly what `confirmCodCollectionAction`
 * does for one order. Eligibility is by capability (`settledByOperatorConfirmation`), not by name.
 */
const markCodCollectedRunner: BulkRunner = async (context) => {
  const loaded = await loadOrders(context);
  if (!loaded.ok) return loaded;
  const intents = await paymentIntentsOfOrders(context.admin, context.principal, context.tenantId, [
    ...loaded.byId.values(),
  ]);
  if (!intents.ok) return intents;
  const results = await perOrder(
    "mark_cod_collected",
    context.tenantId,
    context.orderIds,
    async (orderId) => {
      const order = loaded.byId.get(orderId);
      if (order === undefined) return failed(orderId, "not_found");
      if (derivePaymentStatus(order.history) !== "pending")
        return skipped(orderId, "payment_not_pending");
      const intent =
        order.paymentRef === undefined ? undefined : intents.byId.get(order.paymentRef);
      if (
        intent === undefined ||
        !intent.settledByOperatorConfirmation ||
        intent.orderRef !== orderId ||
        NOT_COLLECTIBLE.has(intent.status)
      ) {
        return skipped(orderId, "not_cash_on_delivery");
      }
      const response = await context.admin.payments.confirmCodCollection(context.principal, {
        tenantId: context.tenantId,
        paymentIntentId: intent.id,
        collectedAmountMinor: intent.amountMinor,
        currency: intent.currency,
      });
      return succeeded(response) ? done(orderId) : failed(orderId, reasonOf(response));
    },
  );
  return { ok: true, results };
};

/** Each bulk action's runner. Part 2 adds add_tags / remove_tags here. */
export const BULK_RUNNERS: Readonly<Record<BulkOrderAction, BulkRunner>> = {
  archive: archiveRunner(true),
  unarchive: archiveRunner(false),
  fulfill: fulfillRunner,
  capture_payments: capturePaymentsRunner,
  mark_cod_collected: markCodCollectedRunner,
};
