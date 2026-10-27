import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutSession } from "@platform/checkout";
import type { Principal } from "@platform/contracts";
import { mapError } from "@platform/http";
import type { DraftOrder, Order } from "@platform/orders";
import type { PaymentIntentSummary } from "@platform/payments";
import {
  BusinessRuleError,
  logger,
  NotFoundError,
  toErrorEnvelope,
  ValidationError,
} from "@platform/utils";
import { codCollectionState } from "./cod-collection";
import { materializeDraftCheckout } from "./draft-order-checkout";
import type { DraftOrderDto } from "./draft-order-dto";
import { completeCheckout, unwrap } from "./testing/abandoned-harness";
import {
  createDraft,
  draftBody,
  draftWorld,
  enableCashOnDelivery,
  type DraftWorld,
} from "./testing/draft-harness";
import { adminStaff, HARNESS_TENANT, operatorStaff, viewerStaff } from "./testing/orders-harness";

const complete = (
  world: DraftWorld,
  draftId: string,
  payment: "paid" | "collect_on_delivery",
  principal: Principal = operatorStaff,
) =>
  world.staffCall(
    "POST",
    "/draft-orders/:draftId/complete",
    { params: { draftId }, body: { payment } },
    principal,
  );
const orderOf = async (world: DraftWorld, orderId: string) =>
  unwrap<Order>(
    await world.admin.orders.getOrder(adminStaff, { tenantId: HARNESS_TENANT, orderId }),
    "order",
  );
const orderCount = async (world: DraftWorld) =>
  unwrap<{ items: unknown[] }>(
    await world.admin.orders.listOrders(adminStaff, { tenantId: HARNESS_TENANT, first: 50 }),
    "orders",
  ).items.length;
const draftOf = async (world: DraftWorld, draftId: string) =>
  unwrap<DraftOrderDto>(
    await world.staffCall("GET", "/draft-orders/:draftId", { params: { draftId } }, viewerStaff),
    "draft",
  );
const storedDraft = async (world: DraftWorld, draftId: string) =>
  unwrap<DraftOrder>(
    await world.admin.publicReads.draftOrders.getDraftOrder({ tenantId: HARNESS_TENANT, draftId }),
    "stored draft",
  );
const codeOf = (reply: { body: unknown }) => (reply.body as { code?: string }).code;
/** Checkout's own view of a session, read past the ownership check. */
const sessionOf = async (world: DraftWorld, checkoutSessionId: string) =>
  unwrap<CheckoutSession>(
    await world.admin.publicReads.checkout.get({ tenantId: HARNESS_TENANT, checkoutSessionId }),
    "session",
  );
const stateOf = async (world: DraftWorld, checkoutSessionId: string) =>
  (await sessionOf(world, checkoutSessionId)).state.value;
const sendLink = async (world: DraftWorld, draftId: string) =>
  unwrap<{ path: string }>(
    await world.staffCall(
      "POST",
      "/draft-orders/:draftId/invoice-link",
      { params: { draftId } },
      operatorStaff,
    ),
    "send",
  ).path.slice("/c/".length);
const claim = async (world: DraftWorld, token: string, sessionRef: string) =>
  unwrap<{ checkoutSessionId: string }>(
    await world.publicCall("POST", "/public/checkout-links/claim", {
      body: { token, sessionRef },
    }),
    "claim",
  ).checkoutSessionId;
/** Checkout's report to Orders never arrives: only the admin route's own bookkeeping records it. */
const silentPort = { complete: () => Promise.reject(new Error("Orders is unreachable")) };

describe("POST /draft-orders/:draftId/complete (spec §4.6)", () => {
  // Payments reports each captured payment at info level; the assertions below read the records.
  beforeEach(() => {
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collect on delivery needs cash on delivery enabled (Ruling 7) — nothing is created", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const refused = await complete(world, draft.id, "collect_on_delivery");
    expect(refused.status).toBe(409);
    expect(codeOf(refused)).toBe("COD_NOT_ENABLED");
    expect(await orderCount(world)).toBe(0);
    expect((await storedDraft(world, draft.id)).checkoutRef).toBeNull();
  });

  it("collect on delivery creates #1001 with payment pending, the note, tags and a created_from_draft line", async () => {
    const world = await draftWorld();
    await enableCashOnDelivery(world);
    const draft = await createDraft(world);
    const done = unwrap<{ orderId: string; orderNumber: string }>(
      await complete(world, draft.id, "collect_on_delivery"),
      "complete",
    );
    expect(done.orderNumber).toBe("1001");
    const order = await orderOf(world, done.orderId);
    expect(order.status).toBe("payment_requested");
    const after = await draftOf(world, draft.id);
    expect(after.status).toBe("completed");
    expect(after.order).toEqual({ id: done.orderId, orderNumber: "1001" });
    const annotations = unwrap<
      ReadonlyMap<string, { note: string | null; tags: readonly string[] }>
    >(
      await world.admin.orders.orderAnnotations(adminStaff, {
        tenantId: HARNESS_TENANT,
        orderIds: [done.orderId],
      }),
      "annotations",
    );
    expect(annotations.get(done.orderId)).toMatchObject({
      note: "Deliver after 5 pm",
      tags: ["WhatsApp"],
    });
    const timeline = unwrap<{
      entries: { kind: string; data: { draftNumber?: string; draftId?: string } }[];
    }>(
      await world.admin.orders.orderTimeline(adminStaff, {
        tenantId: HARNESS_TENANT,
        orderId: done.orderId,
      }),
      "timeline",
    );
    expect(timeline.entries.map((e) => [e.kind, e.data])).toContainEqual([
      "created_from_draft",
      { draftNumber: "D1", draftId: draft.id },
    ]);
    const [summary] = unwrap<readonly PaymentIntentSummary[]>(
      await world.admin.orders.paymentIntentsOf(adminStaff, {
        tenantId: HARNESS_TENANT,
        paymentIntentIds: [order.paymentRef ?? ""],
      }),
      "intents",
    );
    expect(summary).toMatchObject({ provider: "cod", collectedOnDelivery: true });
  });

  it("Mark as paid is admin-only; it records a captured manual payment that is never cash to collect (binding carry 4)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    expect((await complete(world, draft.id, "paid", operatorStaff)).status).toBe(403);
    expect(await orderCount(world)).toBe(0);
    const done = unwrap<{ orderId: string }>(
      await complete(world, draft.id, "paid", adminStaff),
      "paid",
    );
    const order = await orderOf(world, done.orderId);
    const paymentRef = order.paymentRef ?? "";
    const [summary] = unwrap<readonly PaymentIntentSummary[]>(
      await world.admin.orders.paymentIntentsOf(adminStaff, {
        tenantId: HARNESS_TENANT,
        paymentIntentIds: [paymentRef],
      }),
      "intents",
    );
    expect(summary).toMatchObject({
      provider: "manual",
      status: "captured",
      collectedOnDelivery: false,
    });
    expect(codCollectionState(order, summary)).toEqual({
      printAmount: false,
      canMarkCollected: false,
    });
    // In production PaymentCapturedConsumer makes this call on the captured event (no consumer runs here).
    const paid = await world.admin.orders.markOrderPaid(adminStaff, {
      tenantId: HARNESS_TENANT,
      orderId: done.orderId,
      paymentRef,
    });
    expect(paid.status).toBe(200);
    expect((await orderOf(world, done.orderId)).status).toBe("payment_received");
  });

  it("a retry after the order exists resumes, never a second order (Review Focus 2, Ruling 6)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const first = unwrap<{ orderId: string }>(
      await complete(world, draft.id, "paid", adminStaff),
      "first",
    );
    const retry = unwrap<{ orderId: string }>(
      await complete(world, draft.id, "paid", adminStaff),
      "retry",
    );
    expect(retry.orderId).toBe(first.orderId);
    expect(await orderCount(world)).toBe(1);
    const other = await complete(world, draft.id, "collect_on_delivery", adminStaff);
    expect(other.status).toBe(409);
    expect(codeOf(other)).toBe("ALREADY_COMPLETED");
  });

  it("a guest draft without an email cannot be completed directly (spec §4.5)", async () => {
    const world = await draftWorld();
    await enableCashOnDelivery(world);
    const draft = await createDraft(world, { email: null });
    const refused = await complete(world, draft.id, "collect_on_delivery");
    expect(refused.status).toBe(422);
    expect((refused.body as { fields: { field: string }[] }).fields.map((f) => f.field)).toEqual([
      "email",
    ]);
  });

  it("not enough stock answers OUT_OF_STOCK and leaves no order (Review Focus 3)", async () => {
    const world = await draftWorld();
    await enableCashOnDelivery(world);
    const draft = await createDraft(world, {
      lines: [{ productId: world.tee.productId, variantId: world.tee.variantId, quantity: 150 }],
    });
    const refused = await complete(world, draft.id, "collect_on_delivery");
    expect(refused.status).toBe(409);
    expect(codeOf(refused)).toBe("OUT_OF_STOCK");
    expect(await orderCount(world)).toBe(0);
    expect((await draftOf(world, draft.id)).status).toBe("open");
  });

  it("the merchant's completion expires a customer's open invoice checkout first (spec Concurrency)", async () => {
    const world = await draftWorld();
    await enableCashOnDelivery(world);
    const draft = await createDraft(world);
    const link = unwrap<{ path: string }>(
      await world.staffCall(
        "POST",
        "/draft-orders/:draftId/invoice-link",
        { params: { draftId: draft.id } },
        operatorStaff,
      ),
      "send",
    );
    const claimed = unwrap<{ checkoutSessionId: string }>(
      await world.publicCall("POST", "/public/checkout-links/claim", {
        body: { token: link.path.slice(3), sessionRef: "guest-a" },
      }),
      "claim",
    );
    unwrap(await complete(world, draft.id, "collect_on_delivery"), "merchant completes");
    const customer = await world.publicCall(
      "POST",
      "/public/checkouts/:checkoutSessionId/complete",
      {
        params: { checkoutSessionId: claimed.checkoutSessionId },
        body: { sessionRef: "guest-a", idempotencyKey: "k-customer" },
      },
    );
    expect(customer.status).not.toBe(200);
    expect(await stateOf(world, claimed.checkoutSessionId)).toBe("expired");
    expect(await orderCount(world)).toBe(1);
  });

  it("a customer's order the port never reported is healed, never placed twice (Ruling 5)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      const world = await draftWorld({ draftCompletion: silentPort });
      await enableCashOnDelivery(world);
      const draft = await createDraft(world);
      const link = unwrap<{ path: string }>(
        await world.staffCall(
          "POST",
          "/draft-orders/:draftId/invoice-link",
          { params: { draftId: draft.id } },
          operatorStaff,
        ),
        "send",
      );
      const claimed = unwrap<{ checkoutSessionId: string }>(
        await world.publicCall("POST", "/public/checkout-links/claim", {
          body: { token: link.path.slice(3), sessionRef: "guest-a" },
        }),
        "claim",
      );
      const orderRef = await completeCheckout(world, claimed.checkoutSessionId, "guest-a");
      expect((await storedDraft(world, draft.id)).status).toBe("invoice_sent");
      // The shopper's checkout chose no merchant payment, so the merchant's choice cannot resume it.
      const refused = await complete(world, draft.id, "collect_on_delivery");
      expect(refused.status).toBe(409);
      expect(codeOf(refused)).toBe("ALREADY_COMPLETED");
      expect(await orderCount(world)).toBe(1);
      const stored = await storedDraft(world, draft.id);
      expect(stored.status).toBe("completed");
      expect(stored.orderRef).toBe(orderRef);
    } finally {
      warn.mockRestore();
    }
  });

  it("an order Orders could not see leaves the draft open (503); the retry resumes the same order (Ruling 12)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      const world = await draftWorld({ draftCompletion: silentPort });
      await enableCashOnDelivery(world);
      const draft = await createDraft(world);
      vi.spyOn(
        world.admin.publicReads.draftOrders,
        "completeDraftFromCheckout",
      ).mockResolvedValueOnce({
        status: 404,
        body: toErrorEnvelope(new NotFoundError("Order not found")),
      });
      vi.spyOn(world.admin.orders, "getOrder").mockResolvedValueOnce({
        status: 404,
        body: toErrorEnvelope(new NotFoundError("Order not found")),
      });
      const first = await complete(world, draft.id, "collect_on_delivery");
      expect(first.status).toBe(503);
      expect((await storedDraft(world, draft.id)).status).toBe("open");
      const retry = unwrap<{ orderId: string; orderNumber: string }>(
        await complete(world, draft.id, "collect_on_delivery"),
        "retry",
      );
      expect(retry.orderNumber).toBe("1001");
      expect(await orderCount(world)).toBe(1);
      expect((await storedDraft(world, draft.id)).orderRef).toBe(retry.orderId);
      expect((await orderOf(world, retry.orderId)).status).toBe("payment_requested");
    } finally {
      warn.mockRestore();
    }
  });

  it("a draft another order completed meanwhile answers ALREADY_COMPLETED, not this order's success", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      const world = await draftWorld({ draftCompletion: silentPort });
      await enableCashOnDelivery(world);
      const draft = await createDraft(world);
      vi.spyOn(
        world.admin.publicReads.draftOrders,
        "completeDraftFromCheckout",
      ).mockResolvedValueOnce({
        status: 409,
        body: toErrorEnvelope(
          new BusinessRuleError("DRAFT_COMPLETED: this draft order is already an order"),
        ),
      });
      const refused = await complete(world, draft.id, "collect_on_delivery");
      expect(refused.status).toBe(409);
      expect(codeOf(refused)).toBe("ALREADY_COMPLETED");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("draft order"),
        expect.objectContaining({ draftId: draft.id }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("every 409 carries a code: an uncoded refusal is DRAFT_BUSY, a coded one keeps its own (Pre-flight 7)", async () => {
    const world = await draftWorld();
    await enableCashOnDelivery(world);
    const draft = await createDraft(world);
    vi.spyOn(world.admin.publicReads.checkout, "complete").mockResolvedValueOnce({
      status: 409,
      body: toErrorEnvelope(
        new BusinessRuleError("Checkout session is expired and can no longer be modified"),
      ),
    });
    const busy = await complete(world, draft.id, "collect_on_delivery");
    expect(busy.status).toBe(409);
    expect(codeOf(busy)).toBe("DRAFT_BUSY");
    vi.spyOn(world.admin.publicReads.checkout, "startDraft").mockResolvedValueOnce({
      status: 409,
      body: toErrorEnvelope(new BusinessRuleError("DRAFT_TOTAL_TOO_LARGE: the total is too large")),
    });
    const large = await complete(world, draft.id, "collect_on_delivery");
    expect(large.status).toBe(409);
    expect(codeOf(large)).toBe("DRAFT_TOTAL_TOO_LARGE");
    expect(await orderCount(world)).toBe(0);
  });

  it("viewers are refused", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    expect((await complete(world, draft.id, "collect_on_delivery", viewerStaff)).status).toBe(403);
  });
});

describe("draft completion races and the merchant's payment (Task 7 fix round 1)", () => {
  beforeEach(() => {
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an edit committed while the merchant's checkout is built refuses it: DRAFT_BUSY, no order (I-1 A)", async () => {
    const world = await draftWorld();
    await enableCashOnDelivery(world);
    const draft = await createDraft(world);
    const checkout = world.admin.publicReads.checkout;
    const startDraft = checkout.startDraft.bind(checkout);
    let built = "";
    vi.spyOn(checkout, "startDraft").mockImplementationOnce(async (input) => {
      const stored = await storedDraft(world, draft.id);
      unwrap(
        await world.admin.draftOrders.update(operatorStaff, {
          tenantId: HARNESS_TENANT,
          draftId: draft.id,
          version: stored.version,
          content: { ...stored.content(), note: "edited meanwhile" },
        }),
        "concurrent edit",
      );
      const started = await startDraft(input);
      built = (started.body as { checkoutSessionId: string }).checkoutSessionId;
      return started;
    });
    const refused = await complete(world, draft.id, "collect_on_delivery");
    expect(refused.status).toBe(409);
    expect(codeOf(refused)).toBe("DRAFT_BUSY");
    expect(await orderCount(world)).toBe(0);
    expect(await stateOf(world, built)).toBe("expired");
  });

  it("a PUT expires the session a claim recorded after the PUT read the draft (I-1 B)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const update = world.admin.draftOrders.update.bind(world.admin.draftOrders);
    let recorded = "";
    vi.spyOn(world.admin.draftOrders, "update").mockImplementationOnce(async (principal, input) => {
      // A shopper's claim materialises from the version the PUT is about to replace.
      const stored = await storedDraft(world, draft.id);
      const built = await materializeDraftCheckout(world.admin, HARNESS_TENANT, stored, {
        fresh: false,
      });
      if (!built.ok) throw new Error(`materialise answered ${built.response.status}`);
      recorded = built.checkoutSessionId;
      return update(principal, input);
    });
    const edited = await world.staffCall(
      "PUT",
      "/draft-orders/:draftId",
      {
        params: { draftId: draft.id },
        body: { ...draftBody(world, { discount: null }), version: draft.version },
      },
      operatorStaff,
    );
    expect(edited.status).toBe(200);
    expect(recorded).not.toBe("");
    expect(await stateOf(world, recorded)).toBe("expired");
  });

  it("a failed Mark as paid closes its session; the next claim never gets the manual selection (I-2)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world, {
      lines: [{ productId: world.tee.productId, variantId: world.tee.variantId, quantity: 150 }],
    });
    const refused = await complete(world, draft.id, "paid", adminStaff);
    expect(codeOf(refused)).toBe("OUT_OF_STOCK");
    const merchants = (await storedDraft(world, draft.id)).checkoutRef ?? "";
    expect(merchants).not.toBe("");
    expect(await stateOf(world, merchants)).toBe("expired");
    const claimed = await claim(world, await sendLink(world, draft.id), "guest-a");
    expect(claimed).not.toBe(merchants);
    expect((await sessionOf(world, claimed)).paymentSelection).toBeUndefined();
  });

  it("a claim never reuses a session with the manual selection, even an open one (I-2 b)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = await sendLink(world, draft.id);
    const first = await claim(world, token, "guest-a");
    unwrap(
      await world.admin.publicReads.checkout.selectDraftPayment({
        tenantId: HARNESS_TENANT,
        checkoutSessionId: first,
        provider: "manual",
      }),
      "select manual",
    );
    const second = await claim(world, token, "guest-a");
    expect(second).not.toBe(first);
    expect(await stateOf(world, first)).toBe("expired");
    expect((await sessionOf(world, second)).paymentSelection).toBeUndefined();
  });

  it("a shopper can never open a manual payment, even on a draft session with manual selected (I-2 c)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const checkoutSessionId = await claim(world, await sendLink(world, draft.id), "guest-a");
    unwrap(
      await world.admin.publicReads.checkout.selectDraftPayment({
        tenantId: HARNESS_TENANT,
        checkoutSessionId,
        provider: "manual",
      }),
      "select manual",
    );
    const orderRef = await completeCheckout(world, checkoutSessionId, "guest-a");
    const refused = await world
      .publicCall("POST", "/public/checkouts/:checkoutSessionId/payment", {
        params: { checkoutSessionId },
        body: { sessionRef: "guest-a" },
      })
      .then(
        (reply) => reply.status,
        (error: unknown) => mapError(error).status,
      );
    expect(refused).toBe(422);
    expect((await orderOf(world, orderRef)).paymentRef ?? null).toBeNull();
  });

  it("a payment Payments refused answers PAYMENT_NOT_RECORDED; a new submit resumes the same order (M-1)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const world = await draftWorld();
    const draft = await createDraft(world);
    vi.spyOn(world.admin.publicReads.checkout, "initiatePayment").mockRejectedValueOnce(
      new ValidationError("Payment method is not available"),
    );
    const first = await complete(world, draft.id, "paid", adminStaff);
    expect(first.status).toBe(409);
    expect(codeOf(first)).toBe("PAYMENT_NOT_RECORDED");
    expect(warn).toHaveBeenCalledWith("draft order payment could not be opened", expect.anything());
    const stored = await storedDraft(world, draft.id);
    expect(stored.status).toBe("completed");
    expect(await orderCount(world)).toBe(1);
    const retry = unwrap<{ orderId: string }>(
      await complete(world, draft.id, "paid", adminStaff),
      "retry",
    );
    expect(retry.orderId).toBe(stored.orderRef);
    expect(await orderCount(world)).toBe(1);
    const order = await orderOf(world, retry.orderId);
    const [summary] = unwrap<readonly PaymentIntentSummary[]>(
      await world.admin.orders.paymentIntentsOf(adminStaff, {
        tenantId: HARNESS_TENANT,
        paymentIntentIds: [order.paymentRef ?? ""],
      }),
      "intents",
    );
    expect(summary).toMatchObject({ provider: "manual", status: "captured" });
  });

  it("anything but Payments' refusal is not hidden as a retryable 409 (M-2)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    vi.spyOn(world.admin.publicReads.checkout, "initiatePayment").mockRejectedValueOnce(
      new TypeError("cannot read properties of undefined"),
    );
    await expect(complete(world, draft.id, "paid", adminStaff)).rejects.toThrow(TypeError);
  });

  it("a draft pointing at another draft's session is not healed with that order (M-4)", async () => {
    const world = await draftWorld();
    const mine = await createDraft(world);
    const theirs = await createDraft(world);
    const placed = unwrap<{ orderId: string }>(
      await complete(world, theirs.id, "paid", adminStaff),
      "their order",
    );
    const foreign = (await storedDraft(world, theirs.id)).checkoutRef ?? "";
    unwrap(
      await world.admin.publicReads.draftOrders.setDraftCheckout({
        tenantId: HARNESS_TENANT,
        draftId: mine.id,
        checkoutRef: foreign,
        checkoutVersion: mine.version,
        expectedCheckoutRef: null,
      }),
      "point at their session",
    );
    const read = await draftOf(world, mine.id);
    expect(read.status).toBe("open");
    expect(read.order).toBeNull();
    expect((await storedDraft(world, mine.id)).orderRef).not.toBe(placed.orderId);
  });
});

describe("a draft the shopper paid while the merchant's checkout was built (final review I-1)", () => {
  beforeEach(() => {
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The shopper's invoice checkout becomes an order just before Checkout's own transaction runs. */
  function payBeforeStart(world: DraftWorld, checkoutSessionId: string, sessionRef: string) {
    const checkout = world.admin.publicReads.checkout;
    const startDraft = checkout.startDraft.bind(checkout);
    const placed: string[] = [];
    vi.spyOn(checkout, "startDraft").mockImplementationOnce(async (input) => {
      placed.push(await completeCheckout(world, checkoutSessionId, sessionRef));
      return startDraft(input);
    });
    return placed;
  }

  it("the merchant's completion resumes it as ALREADY_COMPLETED, heals the draft, no second order", async () => {
    // Checkout's report to Orders fails, so the draft still reads invoice_sent: the widest window.
    const world = await draftWorld({ draftCompletion: silentPort });
    await enableCashOnDelivery(world);
    const draft = await createDraft(world);
    const shoppers = await claim(world, await sendLink(world, draft.id), "guest-a");
    const placed = payBeforeStart(world, shoppers, "guest-a");

    const refused = await complete(world, draft.id, "collect_on_delivery");

    expect(placed).toHaveLength(1);
    expect(refused.status).toBe(409);
    expect(codeOf(refused)).toBe("ALREADY_COMPLETED");
    expect(await orderCount(world)).toBe(1);
    const stored = await storedDraft(world, draft.id);
    expect(stored.status).toBe("completed");
    expect(stored.orderRef).toBe(placed[0]);
    expect(stored.checkoutRef).toBe(shoppers);
  });

  it("a second opener of the link is told it was already placed, the draft is healed, no second order", async () => {
    const world = await draftWorld({ draftCompletion: silentPort });
    const draft = await createDraft(world);
    const token = await sendLink(world, draft.id);
    const shoppers = await claim(world, token, "guest-a");
    // A newer draft version (its checkout not expired) makes the next claim build a fresh session.
    const stored = await storedDraft(world, draft.id);
    unwrap(
      await world.admin.draftOrders.update(operatorStaff, {
        tenantId: HARNESS_TENANT,
        draftId: draft.id,
        version: stored.version,
        content: { ...stored.content(), note: "edited meanwhile" },
      }),
      "edit",
    );
    const placed = payBeforeStart(world, shoppers, "guest-a");

    const refused = await world.publicCall("POST", "/public/checkout-links/claim", {
      body: { token, sessionRef: "guest-b" },
    });

    expect(placed).toHaveLength(1);
    expect(refused.status).toBe(409);
    expect(codeOf(refused)).toBe("ALREADY_COMPLETED");
    expect(await orderCount(world)).toBe(1);
    const healed = await storedDraft(world, draft.id);
    expect(healed.status).toBe("completed");
    expect(healed.orderRef).toBe(placed[0]);
  });
});
