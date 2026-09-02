import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { Order } from "./domain/order";
import { OrderItem } from "./domain/order-item";
import type { OrderEvent } from "./domain/order-event";
import type { OrderRepository } from "./domain/order-repository";
import { AddressSnapshot } from "./domain/value-objects/address-snapshot";
import { OrderNumber } from "./domain/value-objects/order-number";
import { OrderTotalsSnapshot } from "./domain/value-objects/order-totals-snapshot";
import { ProductSnapshot } from "./domain/value-objects/product-snapshot";
import {
  RequestPaymentCapture,
  type RequestPaymentCaptureDeps,
} from "./application/order-lifecycle.use-cases";
import type { PaymentPort } from "./application/ports";

/**
 * Phase A.15 (Orders, Task 1/2) — same fake shapes `create-intent-transaction-boundary.test.ts`
 * (Payments, Phase A.13) established: a Postgres-like repository reproducing
 * `PrismaOrderRepository`'s optimistic-lock (`version`) contract, and a `TrackingUnitOfWork` that
 * counts currently-open `run()` calls so a `PaymentPort` fake can prove whether it was invoked
 * while a transaction was open.
 */
interface OrderRow {
  readonly orderNumber: OrderNumber;
  readonly customerRef: string;
  readonly currency: string;
  readonly items: readonly OrderItem[];
  readonly shippingAddress: AddressSnapshot;
  readonly history: readonly OrderEvent[];
  readonly version: number;
  readonly billingAddress?: AddressSnapshot;
  readonly paymentRef?: string;
  readonly fulfillmentRef?: string;
}

class PostgresLikeOrderRepository implements OrderRepository {
  private readonly rows = new Map<string, OrderRow>();

  async save(order: Order): Promise<void> {
    const id = order.id.toString();
    const existing = this.rows.get(id);
    if (order.version === 0) {
      if (existing !== undefined) {
        throw new Error("fixture setup error: fresh order id collides with an existing row");
      }
      this.write(order, 1);
      return;
    }
    if (existing === undefined || existing.version !== order.version) {
      throw new ConcurrencyError(
        `Order ${id} was modified concurrently (expected version ${order.version})`,
      );
    }
    this.write(order, existing.version + 1);
  }

  async findById(id: string): Promise<Order | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null;
    return Order.reconstitute(
      UniqueEntityId.from(id),
      row.orderNumber,
      row.customerRef,
      row.currency,
      row.items,
      row.shippingAddress,
      row.history,
      row.version,
      {
        billingAddress: row.billingAddress,
        paymentRef: row.paymentRef,
        fulfillmentRef: row.fulfillmentRef,
      },
    );
  }

  async list(): ReturnType<OrderRepository["list"]> {
    throw new Error("not used by this test");
  }

  /** Seeds a row directly (bypassing version checks) so tests can start from an arbitrary status. */
  seed(order: Order): void {
    this.write(order, 1);
  }

  size(): number {
    return this.rows.size;
  }

  private write(order: Order, version: number): void {
    this.rows.set(order.id.toString(), {
      orderNumber: order.orderNumber,
      customerRef: order.customerRef,
      currency: order.currency,
      items: [...order.items],
      shippingAddress: order.shippingAddress,
      history: [...order.history],
      version,
      billingAddress: order.billingAddress,
      paymentRef: order.paymentRef,
      fulfillmentRef: order.fulfillmentRef,
    });
  }
}

/** Tracks how many `run()` calls are currently open — a stand-in for "a live DB transaction is held". */
class TrackingUnitOfWork implements TransactionalUnitOfWork<unknown> {
  openCount = 0;
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    this.openCount += 1;
    try {
      return await work(undefined);
    } finally {
      this.openCount -= 1;
    }
  }
}

class RecordingPaymentPort implements PaymentPort {
  readonly calls: Array<{
    orderId: string;
    amountMinor: number;
    currency: string;
    openCountAtCall: number;
  }> = [];

  constructor(
    private readonly uow?: TrackingUnitOfWork,
    private readonly failAlways = false,
  ) {}

  async requestCapture(
    orderId: string,
    amountMinor: number,
    currency: string,
  ): Promise<{ paymentRef: string }> {
    this.calls.push({
      orderId,
      amountMinor,
      currency,
      openCountAtCall: this.uow?.openCount ?? -1,
    });
    if (this.failAlways) {
      throw new Error("simulated PSP requestCapture failure");
    }
    return { paymentRef: `psp-ref-${this.calls.length}` };
  }
}

let globalIdCounter = 0;
function sequentialIds(prefix: string): IdGenerator {
  return { generate: () => `${prefix}-${(globalIdCounter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-12T00:00:00.000Z") };

function line(): OrderItem {
  const price = Money.create(1000, "USD");
  if (!price.ok) throw new Error("invalid fixture");
  const snapshot = ProductSnapshot.create("p1", "Product 1", price.value);
  if (!snapshot.ok) throw new Error("invalid fixture");
  return OrderItem.create(UniqueEntityId.from("item-p1"), snapshot.value, 1);
}

function address(): AddressSnapshot {
  const result = AddressSnapshot.create("1 Main St", "Town", "12345", "US");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function orderNumber(id: string): OrderNumber {
  const result = OrderNumber.create(`ORD-${id}`);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

/** Builds a fresh order at `awaiting_payment` (the legal precondition for `RequestPaymentCapture`). */
function orderAwaitingPayment(id: string): Order {
  const order = Order.createFromCheckout(
    UniqueEntityId.from(id),
    orderNumber(id),
    "customer-1",
    "USD",
    [line()],
    address(),
    address(),
    OrderTotalsSnapshot.create({
      subtotalMinor: 1000,
      taxMinor: 0,
      shippingMinor: 0,
      discountMinor: 0,
      totalMinor: 1000,
      currency: "USD",
    }),
    `checkout-${id}`,
    "evt-create",
    new Date(0),
  );
  order.confirm("evt-confirm", new Date(0));
  order.markAwaitingPayment("evt-await", new Date(0));
  order.pullDomainEvents();
  return order;
}

/** Builds an order already at `payment_requested` with a recorded `paymentRef` — the idempotent-resume fixture. */
function orderAlreadyRequested(id: string, paymentRef = "existing-ref"): Order {
  const order = orderAwaitingPayment(id);
  order.requestPayment(paymentRef, "evt-req", new Date(0));
  order.pullDomainEvents();
  return order;
}

function buildDeps(
  orders: OrderRepository,
  paymentPort: PaymentPort,
  unitOfWork: TransactionalUnitOfWork<unknown>,
): RequestPaymentCaptureDeps {
  return {
    orders,
    unitOfWork,
    idGenerator: sequentialIds("evt"),
    clock,
    paymentPort,
  };
}

describe("Task 1/2 — PaymentPort.requestCapture() no longer runs while a DB transaction is open", () => {
  it("FIXED: requestCapture() is invoked with openCountAtCall === 0", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderAwaitingPayment("order-1"));
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingPaymentPort(uow);
    const useCase = new RequestPaymentCapture(buildDeps(repo, provider, uow));

    const result = await useCase.execute({ orderId: "order-1" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("payment_requested");
    expect(provider.calls).toHaveLength(1);
    // Fixed behavior: the precheck's transaction is committed BEFORE the PSP call — no transaction
    // is open while the network call is in flight.
    expect(provider.calls[0]?.openCountAtCall).toBe(0);
  });

  it("the paymentRef is durably persisted by the time execute() resolves", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderAwaitingPayment("order-2"));
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingPaymentPort(uow);
    const useCase = new RequestPaymentCapture(buildDeps(repo, provider, uow));

    await useCase.execute({ orderId: "order-2" });

    const persisted = await repo.findById("order-2");
    expect(persisted?.status).toBe("payment_requested");
    expect(persisted?.paymentRef).toBe("psp-ref-1");
  });
});

describe("Idempotent resume", () => {
  it("a retry against an order already at payment_requested does NOT re-call the PSP", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderAlreadyRequested("order-3", "already-captured-ref"));
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingPaymentPort(uow);
    const useCase = new RequestPaymentCapture(buildDeps(repo, provider, uow));

    const result = await useCase.execute({ orderId: "order-3" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("payment_requested");
    expect(provider.calls).toHaveLength(0);
    const persisted = await repo.findById("order-3");
    expect(persisted?.paymentRef).toBe("already-captured-ref");
  });

  it("a PSP failure leaves the order completely unchanged and rethrows the original error", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderAwaitingPayment("order-4"));
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingPaymentPort(uow, true);
    const useCase = new RequestPaymentCapture(buildDeps(repo, provider, uow));

    await expect(useCase.execute({ orderId: "order-4" })).rejects.toThrow(
      /simulated PSP requestCapture failure/,
    );

    const persisted = await repo.findById("order-4");
    expect(persisted?.status).toBe("awaiting_payment");
    expect(persisted?.paymentRef).toBeUndefined();
  });

  it("a NotFoundError is returned for a missing order, without calling the PSP", async () => {
    const repo = new PostgresLikeOrderRepository();
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingPaymentPort(uow);
    const useCase = new RequestPaymentCapture(buildDeps(repo, provider, uow));

    const result = await useCase.execute({ orderId: "missing" });

    expect(result.ok).toBe(false);
    expect(provider.calls).toHaveLength(0);
  });
});

describe("Task — concurrent capture requests, run repeatedly to rule out flakiness", () => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    it(`run ${attempt}/3: two concurrent execute() calls against the same order both resolve ok, and exactly one paymentRef durably wins`, async () => {
      const repo = new PostgresLikeOrderRepository();
      const orderId = `order-race-${attempt}`;
      repo.seed(orderAwaitingPayment(orderId));
      const uow = new TrackingUnitOfWork();
      const provider = new RecordingPaymentPort(uow);
      const useCase = new RequestPaymentCapture(buildDeps(repo, provider, uow));

      const [a, b] = await Promise.all([
        useCase.execute({ orderId }),
        useCase.execute({ orderId }),
      ]);

      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      if (a.ok && b.ok) {
        // Both racers resolve to the SAME final status/paymentRef — whichever settle() commits
        // first "wins", and the loser's settle() re-reads, finds a paymentRef already recorded,
        // and no-ops instead of throwing ConcurrencyError up to the caller.
        expect(a.value.status).toBe("payment_requested");
        expect(b.value.status).toBe("payment_requested");
      }

      const persisted = await repo.findById(orderId);
      expect(persisted?.status).toBe("payment_requested");
      expect(persisted?.paymentRef).toBeDefined();

      // HONEST documentation of the residual race (see the class doc's "RESIDUAL RISK" section):
      // `precheck()` is a plain read with no reservation write, so BOTH racers can observe
      // "no paymentRef yet" before either commits, and BOTH can reach the PSP call. This assertion
      // does NOT claim the double-call is prevented — it only asserts the call count is one of the
      // two behaviorally-possible outcomes (1 = one racer's precheck saw the other's already-committed
      // paymentRef and short-circuited; 2 = both racers' prechecks interleaved before either committed,
      // so the PSP was actually called twice, and only one of the two resulting paymentRefs was
      // durably kept). Observed in this codebase/runtime: consistently 2 (both racers race past the
      // precheck read before either settle() commits, given no I/O boundary separates them in this
      // fake) — recorded here, not silently asserted as "safe".
      expect([1, 2]).toContain(provider.calls.length);
      expect(provider.calls.length).toBe(2);
    });
  }
});
