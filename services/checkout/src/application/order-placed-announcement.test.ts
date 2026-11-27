import { describe, expect, it, vi } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { logger } from "@platform/utils";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { CompleteCheckout } from "./complete-checkout.use-case";
import type {
  OrderCancellationPort,
  OrderCreationPort,
  OrderPlacedPort,
  OrderStockReservationPort,
} from "./ports";

/** Wave 2b: the placed order is announced once, after the commit, best effort. */

class FakeSessions implements CheckoutSessionRepository {
  readonly store = new Map<string, CheckoutSession>();
  async save(session: CheckoutSession): Promise<void> {
    this.store.set(session.id.toString(), session);
  }
  async findById(id: string): Promise<CheckoutSession | null> {
    return this.store.get(id) ?? null;
  }
}

const address = {
  name: "Mona",
  phone: "01000000000",
  line1: "1 Main St",
  city: "Springfield",
  postalCode: "00000",
  country: "US",
};
function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

const ids: IdGenerator = (() => {
  let n = 0;
  return { generate: () => `evt-${(n += 1)}` };
})();
const clock: Clock = { now: () => new Date("2026-11-26T00:00:00.000Z") };

function setup(
  opts: {
    customerRef?: string;
    resolvedCustomer?: string;
    announce?: OrderPlacedPort["orderPlaced"];
    stock?: "ok" | "gone";
    withPort?: boolean;
  } = {},
) {
  const sessions = new FakeSessions();
  const session = CheckoutSession.start(
    UniqueEntityId.from("cs-1"),
    "cart-1",
    opts.customerRef,
    "ref",
    "USD",
  );
  session.loadItems([must(CheckoutItem.create("product-1", 1, 1000, "USD"))]);
  session.setBillingAddress(must(CheckoutAddress.create(address)));
  session.setShippingAddress(must(CheckoutAddress.create(address)));
  session.recalculateTotals("evt-t", new Date(0));
  session.pullDomainEvents();
  sessions.store.set("cs-1", session);

  const announced: unknown[] = [];
  let sessionStateWhenAnnounced: string | undefined;
  const orderPlaced: OrderPlacedPort = {
    orderPlaced: async (input) => {
      sessionStateWhenAnnounced = (await sessions.findById("cs-1"))?.state.value;
      announced.push(input);
      if (opts.announce !== undefined) await opts.announce(input);
    },
  };
  const orderCreation: OrderCreationPort = {
    create: async () => ({
      orderRef: "order-1",
      ...(opts.resolvedCustomer === undefined ? {} : { customerRef: opts.resolvedCustomer }),
    }),
  };
  const cancelled: string[] = [];
  const stockReservation: OrderStockReservationPort = {
    reserve: async () =>
      opts.stock === "gone" ? { ok: false, reason: "insufficient stock" } : { ok: true },
    release: async () => undefined,
  };
  const orderCancellation: OrderCancellationPort = {
    cancel: async (orderId) => void cancelled.push(orderId),
  };
  const useCase = new CompleteCheckout({
    sessions,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: ids,
    clock,
    orderCreation,
    stockReservation,
    orderCancellation,
    ...(opts.withPort === false ? {} : { orderPlaced }),
  });
  const complete = () =>
    useCase.execute({ tenantId: "t1", checkoutSessionId: "cs-1", idempotencyKey: "idem-1" });
  return { announced, complete, cancelled, state: () => sessionStateWhenAnnounced };
}

describe("CompleteCheckout announces the placed order (Wave 2b)", () => {
  it("signed in: once, with the tenant, the order and the customer, after the checkout is completed", async () => {
    expect.hasAssertions();
    const t = setup({ customerRef: "customer-1" });
    expect((await t.complete()).ok).toBe(true);
    expect(t.announced).toEqual([
      { tenantId: "t1", orderRef: "order-1", customerRef: "customer-1" },
    ]);
    expect(t.state()).toBe("completed");
  });

  it("guest: the customer the order resolved from the email", async () => {
    expect.hasAssertions();
    const t = setup({ resolvedCustomer: "guest-9" });
    await t.complete();
    expect(t.announced).toEqual([{ tenantId: "t1", orderRef: "order-1", customerRef: "guest-9" }]);
  });

  it("a retried completion returns the finished order and never announces again", async () => {
    expect.hasAssertions();
    const t = setup({ customerRef: "customer-1" });
    await t.complete();
    const again = await t.complete();
    expect(again.ok).toBe(true);
    expect(t.announced).toHaveLength(1);
  });

  it("an order the checkout undid (no stock) is never announced", async () => {
    expect.hasAssertions();
    const t = setup({ customerRef: "customer-1", stock: "gone" });
    const result = await t.complete();
    expect(result.ok).toBe(false);
    expect(t.cancelled).toEqual(["order-1"]);
    expect(t.announced).toEqual([]);
  });

  it("an announcement that fails never fails the order; the warning carries no address", async () => {
    expect.hasAssertions();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const t = setup({
      customerRef: "customer-1",
      announce: async () => {
        throw new Error("notifications are down");
      },
    });
    const result = await t.complete();
    expect(result.ok && result.value).toEqual({
      checkoutSessionId: "cs-1",
      state: "completed",
      orderRef: "order-1",
    });
    expect(warn).toHaveBeenCalledWith("could not announce the placed order", {
      tenantId: "t1",
      orderRef: "order-1",
      error: "notifications are down",
    });
    warn.mockRestore();
  });

  it("with no port wired (any earlier caller) nothing is announced and nothing breaks", async () => {
    expect.hasAssertions();
    const t = setup({ customerRef: "customer-1", withPort: false });
    expect((await t.complete()).ok).toBe(true);
    expect(t.announced).toEqual([]);
  });
});
