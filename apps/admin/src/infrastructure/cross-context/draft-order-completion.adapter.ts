import type { DraftOrderCompletionPort } from "@platform/checkout";
import type { DraftOrder, OrderController } from "@platform/orders";

type CompletionInput = Parameters<DraftOrderCompletionPort["complete"]>[0];

/** Why Orders did not record a draft's completion (each branch has its own message). */
export type DraftCompletionFailure =
  /** The order is not visible to the shop: the draft was not completed. */
  | "order_not_visible"
  /** No such draft in this shop. */
  | "draft_missing"
  /** Another order already completed the draft: this order is an orphan of it. */
  | "completed_by_another_order"
  /** Any other answer from Orders. */
  | "refused";

export class DraftCompletionNotRecorded extends Error {
  readonly failure: DraftCompletionFailure;

  constructor(failure: DraftCompletionFailure, message: string) {
    super(`DraftOrderCompletionAdapter: ${message}`);
    this.name = "DraftCompletionNotRecorded";
    this.failure = failure;
  }
}

const messageOf = (body: unknown): string => {
  const message = (body as { readonly message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "";
};

/**
 * Real `DraftOrderCompletionPort` (order operations Part 4): Checkout reports that a draft order's
 * checkout became an order; Orders marks the draft completed, copies its note and tags and writes the
 * timeline line. Stateless: the tenant arrives with every call.
 *
 * The same order completing the same draft again is success, however Orders words it (`changed:false`,
 * or a `DRAFT_COMPLETED:` refusal whose draft names this very order). Everything else is thrown with a
 * message of its own; Checkout catches and logs it after the order is committed, so a payment is never
 * affected by what happens here.
 *
 * The two NOT_FOUND answers are told apart by asking Orders about the ORDER, not by their wording:
 * `CompleteDraftFromCheckout` checks the draft first (any row, deleted or not) and the order second,
 * so an order this shop can see means the draft was the missing one. An order it cannot see is
 * reported with "the draft was not completed" only, which holds whether or not the draft exists.
 */
export class DraftOrderCompletionAdapter implements DraftOrderCompletionPort {
  private readonly orders: Pick<
    OrderController,
    "completeDraftFromCheckout" | "getDraftOrder" | "getOrder"
  >;

  constructor(
    orders: Pick<OrderController, "completeDraftFromCheckout" | "getDraftOrder" | "getOrder">,
  ) {
    this.orders = orders;
  }

  async complete(input: CompletionInput): Promise<void> {
    const response = await this.orders.completeDraftFromCheckout({
      tenantId: input.tenantId,
      draftId: input.draftOrderRef,
      orderRef: input.orderRef,
      ...(input.actorRef === undefined ? {} : { actorRef: input.actorRef }),
    });
    // 200 covers both a fresh completion and `changed: false` (this order completed it before).
    if (response.status === 200) return;
    const message = messageOf(response.body);
    if (response.status === 409 && message.startsWith("DRAFT_COMPLETED:")) {
      const holder = await this.completedBy(input);
      if (holder === input.orderRef) return;
      throw new DraftCompletionNotRecorded(
        "completed_by_another_order",
        `draft ${input.draftOrderRef} was already completed by order ${holder ?? "(unknown)"}; ` +
          `order ${input.orderRef} was placed from it too and is an orphan the merchant must review`,
      );
    }
    if (response.status === 404) {
      const orderVisible = await this.isOrderVisible(input);
      if (orderVisible === false) {
        throw new DraftCompletionNotRecorded(
          "order_not_visible",
          `order ${input.orderRef} is not visible to this shop; draft ` +
            `${input.draftOrderRef} was not completed`,
        );
      }
      if (orderVisible === true) {
        throw new DraftCompletionNotRecorded(
          "draft_missing",
          `draft ${input.draftOrderRef} does not exist in this shop (order ${input.orderRef})`,
        );
      }
    }
    throw new DraftCompletionNotRecorded(
      "refused",
      `Orders answered ${response.status} for draft ${input.draftOrderRef} and order ` +
        `${input.orderRef}: ${message}`,
    );
  }

  /** The order that completed the draft, or null when the draft cannot be read. */
  private async completedBy(input: CompletionInput): Promise<string | null> {
    try {
      const found = await this.orders.getDraftOrder({
        tenantId: input.tenantId,
        draftId: input.draftOrderRef,
      });
      return found.status === 200 ? (found.body as DraftOrder).orderRef : null;
    } catch {
      return null;
    }
  }

  /** True / false when Orders answered; null when the lookup itself failed (no verdict). */
  private async isOrderVisible(input: CompletionInput): Promise<boolean | null> {
    try {
      const found = await this.orders.getOrder({
        tenantId: input.tenantId,
        orderId: input.orderRef,
      });
      if (found.status === 200) return true;
      return found.status === 404 ? false : null;
    } catch {
      return null;
    }
  }
}
