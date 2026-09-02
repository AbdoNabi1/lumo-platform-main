import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import type { OrderCreationPort } from "./ports";
import { CompleteCheckout } from "./complete-checkout.use-case";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function address(): CheckoutAddress {
  return must(
    CheckoutAddress.create({
      line1: "1 Main St",
      city: "Springfield",
      postalCode: "00000",
      country: "US",
    }),
  );
}

function item(): CheckoutItem {
  return must(CheckoutItem.create("product-1", 2, 1000, "USD"));
}

/** A session with items/addresses/totals already assembled, ready for `generateOrderDraft()`. */
function readySession(id = "cs-1"): CheckoutSession {
  const session = CheckoutSession.start(
    UniqueEntityId.from(id),
    "cart-1",
    "customer-1",
    "session-1",
    "USD",
  );
  session.loadItems([item()]);
  session.setBillingAddress(address());
  session.setShippingAddress(address());
  session.recalculateTotals("evt-totals", new Date(0));
  session.pullDomainEvents();
  return session;
}

class FakeSessionRepository implements CheckoutSessionRepository {
  private readonly store = new Map<string, CheckoutSession>();

  seed(session: CheckoutSession): void {
    this.store.set(session.id.toString(), session);
  }

  async save(session: CheckoutSession): Promise<void> {
    this.store.set(session.id.toString(), session);
  }

  async findById(id: string): Promise<CheckoutSession | null> {
    return this.store.get(id) ?? null;
  }
}

class NoopUnitOfWork {
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}

class FakeOrderCreationPort implements OrderCreationPort {
  callCount = 0;
  constructor(private readonly orderRef: string) {}

  async create(): Promise<{ readonly orderRef: string }> {
    this.callCount += 1;
    return { orderRef: this.orderRef };
  }
}

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `evt-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };

describe("CompleteCheckout", () => {
  it("creates the order via OrderCreationPort and completes the session", async () => {
    const sessions = new FakeSessionRepository();
    sessions.seed(readySession());
    const orderCreation = new FakeOrderCreationPort("order-abc");
    const useCase = new CompleteCheckout({
      sessions,
      unitOfWork: new NoopUnitOfWork(),
      idGenerator: sequentialIds(),
      clock,
      orderCreation,
    });

    const result = await useCase.execute({
      checkoutSessionId: "cs-1",
      idempotencyKey: "idem-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.orderRef).toBe("order-abc");
    expect(result.value.state).toBe("completed");
    expect(orderCreation.callCount).toBe(1);

    const persisted = await sessions.findById("cs-1");
    expect(persisted?.orderRef).toBe("order-abc");
    expect(persisted?.state.value).toBe("completed");
  });

  it("returns the same orderRef without creating a second order on a repeated call with the same idempotencyKey", async () => {
    const sessions = new FakeSessionRepository();
    sessions.seed(readySession());
    const orderCreation = new FakeOrderCreationPort("order-abc");
    const useCase = new CompleteCheckout({
      sessions,
      unitOfWork: new NoopUnitOfWork(),
      idGenerator: sequentialIds(),
      clock,
      orderCreation,
    });
    const input = { checkoutSessionId: "cs-1", idempotencyKey: "idem-1" };

    const first = await useCase.execute(input);
    expect(first.ok).toBe(true);

    const second = await useCase.execute(input);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected ok");
    expect(second.value.orderRef).toBe("order-abc");
    expect(orderCreation.callCount).toBe(1);
  });

  it("returns a NotFoundError for an unknown session", async () => {
    const sessions = new FakeSessionRepository();
    const orderCreation = new FakeOrderCreationPort("order-abc");
    const useCase = new CompleteCheckout({
      sessions,
      unitOfWork: new NoopUnitOfWork(),
      idGenerator: sequentialIds(),
      clock,
      orderCreation,
    });

    const result = await useCase.execute({
      checkoutSessionId: "missing",
      idempotencyKey: "idem-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("rejects a blank idempotencyKey", async () => {
    const sessions = new FakeSessionRepository();
    sessions.seed(readySession());
    const orderCreation = new FakeOrderCreationPort("order-abc");
    const useCase = new CompleteCheckout({
      sessions,
      unitOfWork: new NoopUnitOfWork(),
      idGenerator: sequentialIds(),
      clock,
      orderCreation,
    });

    const result = await useCase.execute({ checkoutSessionId: "cs-1", idempotencyKey: "  " });

    expect(result.ok).toBe(false);
    expect(orderCreation.callCount).toBe(0);
  });

  it("propagates the domain error when the session cannot yet generate an order draft", async () => {
    const sessions = new FakeSessionRepository();
    sessions.seed(
      CheckoutSession.start(
        UniqueEntityId.from("cs-empty"),
        "cart-1",
        "customer-1",
        "session-1",
        "USD",
      ),
    );
    const orderCreation = new FakeOrderCreationPort("order-abc");
    const useCase = new CompleteCheckout({
      sessions,
      unitOfWork: new NoopUnitOfWork(),
      idGenerator: sequentialIds(),
      clock,
      orderCreation,
    });

    const result = await useCase.execute({
      checkoutSessionId: "cs-empty",
      idempotencyKey: "idem-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("BUSINESS_RULE");
    expect(orderCreation.callCount).toBe(0);
  });

  // Fix round 1, Finding 2 (C-2): fail()/expire() don't clear items/addresses/totals, so a
  // failed/expired session still satisfies generateOrderDraft()'s own checks. Before this fix,
  // execute() would call the real, side-effecting orderCreation.create() for such a session and
  // only discover it can't be completed afterward (session.complete()'s ensureOpen() throwing),
  // by which point session.save() is never reached — an orphaned real order with no session-side
  // record. Assert the port is never reached and an error Result comes back instead.
  it("rejects completion of a failed session WITHOUT calling orderCreation, even though items/addresses/totals are still present", async () => {
    const sessions = new FakeSessionRepository();
    const session = readySession("cs-failed");
    session.fail("payment declined", "evt-fail", new Date(0));
    session.pullDomainEvents();
    sessions.seed(session);
    const orderCreation = new FakeOrderCreationPort("order-abc");
    const useCase = new CompleteCheckout({
      sessions,
      unitOfWork: new NoopUnitOfWork(),
      idGenerator: sequentialIds(),
      clock,
      orderCreation,
    });

    const result = await useCase.execute({
      checkoutSessionId: "cs-failed",
      idempotencyKey: "idem-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("BUSINESS_RULE");
    expect(orderCreation.callCount).toBe(0);

    const persisted = await sessions.findById("cs-failed");
    expect(persisted?.orderRef).toBeNull();
    expect(persisted?.state.value).toBe("failed");
  });

  it("rejects completion of an expired session WITHOUT calling orderCreation, even though items/addresses/totals are still present", async () => {
    const sessions = new FakeSessionRepository();
    const session = readySession("cs-expired");
    session.expire("evt-expire", new Date(0));
    session.pullDomainEvents();
    sessions.seed(session);
    const orderCreation = new FakeOrderCreationPort("order-abc");
    const useCase = new CompleteCheckout({
      sessions,
      unitOfWork: new NoopUnitOfWork(),
      idGenerator: sequentialIds(),
      clock,
      orderCreation,
    });

    const result = await useCase.execute({
      checkoutSessionId: "cs-expired",
      idempotencyKey: "idem-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("BUSINESS_RULE");
    expect(orderCreation.callCount).toBe(0);
  });
});
