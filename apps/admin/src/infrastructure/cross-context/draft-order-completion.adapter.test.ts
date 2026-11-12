import { describe, expect, it, vi } from "vitest";
import { BusinessRuleError, logger, NotFoundError, toErrorEnvelope } from "@platform/utils";
import type { DraftOrderDto } from "../../http/draft-order-dto";
import { unwrap } from "../../http/testing/abandoned-harness";
import { createDraft, draftWorld, type DraftWorld } from "../../http/testing/draft-harness";
import { HARNESS_TENANT, placeTestOrder, viewerStaff } from "../../http/testing/orders-harness";
import {
  DraftCompletionNotRecorded,
  DraftOrderCompletionAdapter,
} from "./draft-order-completion.adapter";

const T = "shop-a";
const DRAFT = "draft-1";
const ORDER = "order-1";
const OTHER = "order-2";

const reply = (status: number, body: unknown) => ({ status, body });
const refusal = (status: number, error: Error) => reply(status, toErrorEnvelope(error));

function stubOrders(
  completion: { status: number; body: unknown },
  reads: {
    readonly draft?: { status: number; body: unknown } | Error;
    readonly order?: { status: number; body: unknown } | Error;
  } = {},
) {
  const answer = (value: { status: number; body: unknown } | Error | undefined) =>
    value instanceof Error
      ? vi.fn().mockRejectedValue(value)
      : vi.fn().mockResolvedValue(value ?? reply(500, null));
  return {
    completeDraftFromCheckout: vi.fn().mockResolvedValue(completion),
    getDraftOrder: answer(reads.draft),
    getOrder: answer(reads.order),
  };
}

async function failureOf(promise: Promise<void>): Promise<DraftCompletionNotRecorded> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DraftCompletionNotRecorded) return error;
    throw error;
  }
  throw new Error("expected the report to be refused");
}

describe("DraftOrderCompletionAdapter", () => {
  it("passes draftId / orderRef / actorRef to Orders and resolves on 200", async () => {
    const orders = stubOrders(reply(200, { draftId: DRAFT, orderRef: ORDER, changed: true }));
    await new DraftOrderCompletionAdapter(orders).complete({
      tenantId: T,
      draftOrderRef: DRAFT,
      orderRef: ORDER,
      actorRef: "staff-1",
    });
    expect(orders.completeDraftFromCheckout).toHaveBeenCalledWith({
      tenantId: T,
      draftId: DRAFT,
      orderRef: ORDER,
      actorRef: "staff-1",
    });
    expect(orders.getDraftOrder).not.toHaveBeenCalled();
  });

  it("omits actorRef for a shopper's payment", async () => {
    const orders = stubOrders(reply(200, { draftId: DRAFT, orderRef: ORDER, changed: true }));
    await new DraftOrderCompletionAdapter(orders).complete({
      tenantId: T,
      draftOrderRef: DRAFT,
      orderRef: ORDER,
    });
    expect(orders.completeDraftFromCheckout).toHaveBeenCalledWith({
      tenantId: T,
      draftId: DRAFT,
      orderRef: ORDER,
    });
  });

  it("the same order again is silent: changed:false", async () => {
    const orders = stubOrders(reply(200, { draftId: DRAFT, orderRef: ORDER, changed: false }));
    await expect(
      new DraftOrderCompletionAdapter(orders).complete({
        tenantId: T,
        draftOrderRef: DRAFT,
        orderRef: ORDER,
      }),
    ).resolves.toBeUndefined();
  });

  it("the same order again is silent: DRAFT_COMPLETED whose draft names this order", async () => {
    const orders = stubOrders(
      refusal(409, new BusinessRuleError("DRAFT_COMPLETED: this draft order is already an order")),
      { draft: reply(200, { orderRef: ORDER }) },
    );
    await expect(
      new DraftOrderCompletionAdapter(orders).complete({
        tenantId: T,
        draftOrderRef: DRAFT,
        orderRef: ORDER,
      }),
    ).resolves.toBeUndefined();
    expect(orders.getDraftOrder).toHaveBeenCalledWith({ tenantId: T, draftId: DRAFT });
  });

  it("DRAFT_COMPLETED by another order throws, naming the orphan and the order that won", async () => {
    const orders = stubOrders(
      refusal(409, new BusinessRuleError("DRAFT_COMPLETED: this draft order is already an order")),
      { draft: reply(200, { orderRef: OTHER }) },
    );
    const failure = await failureOf(
      new DraftOrderCompletionAdapter(orders).complete({
        tenantId: T,
        draftOrderRef: DRAFT,
        orderRef: ORDER,
      }),
    );
    expect(failure.failure).toBe("completed_by_another_order");
    expect(failure.message).toContain(`by order ${OTHER}`);
    expect(failure.message).toContain(`order ${ORDER}`);
    expect(failure.message).toContain("orphan");
    expect(failure.message).not.toMatch(/heal/i);
  });

  it("DRAFT_COMPLETED with an unreadable draft still reports the orphan", async () => {
    const orders = stubOrders(
      refusal(409, new BusinessRuleError("DRAFT_COMPLETED: this draft order is already an order")),
      { draft: new Error("db down") },
    );
    const failure = await failureOf(
      new DraftOrderCompletionAdapter(orders).complete({
        tenantId: T,
        draftOrderRef: DRAFT,
        orderRef: ORDER,
      }),
    );
    expect(failure.failure).toBe("completed_by_another_order");
    expect(failure.message).toContain("(unknown)");
  });

  it("NOT_FOUND with an order the shop cannot see: the draft was not completed", async () => {
    const orders = stubOrders(refusal(404, new NotFoundError("Order not found")), {
      order: refusal(404, new NotFoundError("Order not found")),
    });
    const failure = await failureOf(
      new DraftOrderCompletionAdapter(orders).complete({
        tenantId: T,
        draftOrderRef: DRAFT,
        orderRef: ORDER,
      }),
    );
    expect(failure.failure).toBe("order_not_visible");
    expect(failure.message).toContain(
      `order ${ORDER} is not visible to this shop; draft ${DRAFT} was not completed`,
    );
    expect(failure.message).not.toContain("stays open");
    expect(orders.getOrder).toHaveBeenCalledWith({ tenantId: T, orderId: ORDER });
  });

  it("NOT_FOUND with a visible order: the draft is the missing one (whatever the message says)", async () => {
    // The wording is deliberately the order's: the classification never reads it.
    const orders = stubOrders(refusal(404, new NotFoundError("Order not found")), {
      order: reply(200, { id: ORDER }),
    });
    const failure = await failureOf(
      new DraftOrderCompletionAdapter(orders).complete({
        tenantId: T,
        draftOrderRef: DRAFT,
        orderRef: ORDER,
      }),
    );
    expect(failure.failure).toBe("draft_missing");
    expect(failure.message).toContain(`draft ${DRAFT} does not exist`);
  });

  it("NOT_FOUND with a failing order lookup is reported as a plain refusal", async () => {
    const orders = stubOrders(refusal(404, new NotFoundError("Draft order not found")), {
      order: new Error("db down"),
    });
    const failure = await failureOf(
      new DraftOrderCompletionAdapter(orders).complete({
        tenantId: T,
        draftOrderRef: DRAFT,
        orderRef: ORDER,
      }),
    );
    expect(failure.failure).toBe("refused");
    expect(failure.message).toContain("404");
  });

  it("any other answer throws with the status and Orders' message", async () => {
    const orders = stubOrders(refusal(409, new BusinessRuleError("SOMETHING_ELSE: no")));
    const failure = await failureOf(
      new DraftOrderCompletionAdapter(orders).complete({
        tenantId: T,
        draftOrderRef: DRAFT,
        orderRef: ORDER,
      }),
    );
    expect(failure.failure).toBe("refused");
    expect(failure.message).toContain("409");
    expect(failure.message).toContain("SOMETHING_ELSE");
  });
});

const ADDRESS = {
  name: "Mona Ali",
  phone: "01001234567",
  line1: "5 Nile St",
  city: "Cairo",
  postalCode: "",
  country: "EG",
  province: "EG-C",
};

/** A draft's checkout, as Task 7's routes will build it, through the raw Checkout controller. */
async function draftCheckout(world: DraftWorld, draft: DraftOrderDto): Promise<string> {
  const checkout = world.admin.publicReads.checkout;
  const started = unwrap<{ checkoutSessionId: string }>(
    await checkout.startDraft({
      tenantId: HARNESS_TENANT,
      draftOrderRef: draft.id,
      draftNumber: draft.draftNumber,
      currency: "EGP",
      items: draft.lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        sku: line.sku,
        title: line.title,
        variantTitle: line.variantTitle,
        quantity: line.quantity,
        unitPriceAmountMinor: line.unitPriceMinor,
        currency: "EGP",
      })),
      contactEmail: "sara@example.com",
      shippingAddress: ADDRESS,
      billingAddress: ADDRESS,
      shipping: { title: "Courier", amountMinor: 4000 },
    }),
    "start draft checkout",
  );
  unwrap(
    await checkout.selectDraftPayment({
      tenantId: HARNESS_TENANT,
      checkoutSessionId: started.checkoutSessionId,
      provider: "cod",
    }),
    "select cod",
  );
  return started.checkoutSessionId;
}

async function readDraft(world: DraftWorld, draftId: string): Promise<DraftOrderDto> {
  return unwrap<DraftOrderDto>(
    await world.staffCall("GET", "/draft-orders/:draftId", { params: { draftId } }, viewerStaff),
    "get draft",
  );
}

describe("wireAdmin hands Checkout the real adapter (Part 4 wiring)", () => {
  it("a draft's checkout that becomes an order completes the draft", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world, { discount: null });
    const checkoutSessionId = await draftCheckout(world, draft);
    const done = unwrap<{ orderRef: string }>(
      await world.admin.publicReads.checkout.complete({
        tenantId: HARNESS_TENANT,
        checkoutSessionId,
        idempotencyKey: `complete-${checkoutSessionId}`,
      }),
      "complete",
    );
    const after = await readDraft(world, draft.id);
    expect(after.status).toBe("completed");
    expect(after.order?.id).toBe(done.orderRef);
  });

  it("a refused report never fails the order: the checkout still completes", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world, { discount: null });
    const checkoutSessionId = await draftCheckout(world, draft);
    // Another order closed the draft first, so the adapter throws "completed by another order".
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const first = await placeTestOrder(world.admin);
    unwrap(
      await world.admin.publicReads.draftOrders.completeDraftFromCheckout({
        tenantId: HARNESS_TENANT,
        draftId: draft.id,
        orderRef: first,
      }),
      "complete draft first",
    );
    const done = await world.admin.publicReads.checkout.complete({
      tenantId: HARNESS_TENANT,
      checkoutSessionId,
      idempotencyKey: `complete-${checkoutSessionId}`,
    });
    expect(done.status).toBe(200);
    expect((done.body as { orderRef: string }).orderRef).not.toBe(first);
    expect((await readDraft(world, draft.id)).order?.id).toBe(first);
    // Checkout logged the adapter's own message: the orphan is named.
    expect(warn).toHaveBeenCalledWith(
      "could not record a draft order's completion",
      expect.objectContaining({ error: expect.stringContaining("is an orphan") }),
    );
    warn.mockRestore();
  });
});
