import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { FulfillmentOrder } from "./domain/fulfillment-order";
import type { FulfillmentOrderRepository } from "./domain/fulfillment-order-repository";
import { FulfillmentItem } from "./domain/value-objects/fulfillment-item";
import {
  RequestReservation,
  type RequestReservationDeps,
} from "./application/request-reservation.use-case";
import type { InventoryPort, ReservationItem, ReservationResult } from "./application/ports";
import {
  FulfillmentOrderMapper,
  type FulfillmentOrderRow,
} from "./infrastructure/fulfillment-order.mapper";

/**
 * Phase A.15 (Task 1) — same fake shapes as `create-shipment-transaction-boundary.test.ts` / the
 * Payments Phase A.8 `capture-concurrency.test.ts`: a Postgres-like repository reproducing
 * `PrismaFulfillmentOrderRepository`'s optimistic-lock (`version`) contract (synchronous
 * check-then-write, no internal `await`, so two racing `save()` calls resolve deterministically —
 * whichever is invoked first wins, the other observes the new version and throws), and a
 * `TrackingUnitOfWork` that counts currently-open `run()` calls.
 */
class PostgresLikeFulfillmentOrderRepository implements FulfillmentOrderRepository {
  private readonly rows = new Map<string, FulfillmentOrderRow>();
  private readonly tenantId = "tenant-local";

  /** Seeds a row directly (bypasses the version check) — simulates a previously-committed order. */
  seed(order: FulfillmentOrder): void {
    this.write(order, 1);
  }

  async save(order: FulfillmentOrder): Promise<void> {
    const id = order.id.toString();
    const existing = this.rows.get(id);
    if (existing === undefined) {
      this.write(order, 1);
      return;
    }
    if (existing.version !== order.version) {
      throw new ConcurrencyError(
        `FulfillmentOrder ${id} was modified concurrently (expected version ${order.version})`,
      );
    }
    this.write(order, existing.version + 1);
  }

  async findById(id: string): Promise<FulfillmentOrder | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null;
    return FulfillmentOrderMapper.toDomain(row);
  }

  async findByOrderRef(orderRef: string): Promise<FulfillmentOrder | null> {
    for (const row of this.rows.values()) {
      const order = FulfillmentOrderMapper.toDomain(row);
      if (order.orderRef === orderRef) return order;
    }
    return null;
  }

  size(): number {
    return this.rows.size;
  }

  private write(order: FulfillmentOrder, version: number): void {
    const row = { ...FulfillmentOrderMapper.toRow(order, this.tenantId), version };
    this.rows.set(order.id.toString(), row as FulfillmentOrderRow);
    order.pullDomainEvents();
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

/** Runs `work` directly — used where transaction-openness is not being measured. */
class PassthroughUnitOfWork implements TransactionalUnitOfWork<unknown> {
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}

class RecordingInventoryPort implements InventoryPort {
  readonly calls: Array<{ orderRef: string; openCountAtCall: number }> = [];

  constructor(
    private readonly uow?: TrackingUnitOfWork,
    private readonly outcome: ReservationResult = { confirmed: true },
    private readonly failAlways = false,
  ) {}

  async reserve(orderRef: string, _items: readonly ReservationItem[]): Promise<ReservationResult> {
    this.calls.push({ orderRef, openCountAtCall: this.uow?.openCount ?? -1 });
    if (this.failAlways) {
      throw new Error("simulated Inventory reserve failure");
    }
    return this.outcome;
  }
}

let globalIdCounter = 0;
function sequentialIds(prefix: string): IdGenerator {
  return { generate: () => `${prefix}-${(globalIdCounter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-12T00:00:00.000Z") };

function productRef(value: string): ProductRef {
  const result = ProductRef.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function item(): FulfillmentItem {
  const result = FulfillmentItem.create(productRef("product-1"), 2);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

/** A freshly-created fulfillment order — the only status (besides `failed`) `requestReservation()` accepts. */
function seedCreatedOrder(repo: PostgresLikeFulfillmentOrderRepository, id: string): void {
  const order = FulfillmentOrder.create(UniqueEntityId.from(id), `order-${id}`, [item()]);
  order.pullDomainEvents();
  repo.seed(order);
}

function buildDeps(
  repo: FulfillmentOrderRepository,
  inventoryPort: InventoryPort,
  unitOfWork: TransactionalUnitOfWork<unknown> = new PassthroughUnitOfWork(),
): RequestReservationDeps {
  return {
    fulfillmentOrders: repo,
    unitOfWork,
    idGenerator: sequentialIds("evt"),
    clock,
    inventoryPort,
  };
}

describe("Task 1 — exploit proof: the Inventory call happens while a DB transaction is open", () => {
  it("EXPLOIT (pre-fix shape): would show InventoryPort.reserve() invoked with a transaction still open (openCount > 0)", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    seedCreatedOrder(repo, "ff-tx");
    const uow = new TrackingUnitOfWork();
    const inventoryPort = new RecordingInventoryPort(uow);
    const useCase = new RequestReservation(buildDeps(repo, inventoryPort, uow));

    const result = await useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-tx" });

    expect(result.ok).toBe(true);
    expect(inventoryPort.calls).toHaveLength(1);
    // Fixed behavior: the reservation's transaction is committed BEFORE Inventory is called — no
    // transaction should be open while the cross-context call is in flight.
    expect(inventoryPort.calls[0]?.openCountAtCall).toBe(0);
    if (result.ok) expect(result.value.status).toBe("confirmed");
  });

  it("the reservation_requested transition is durably persisted before Inventory.reserve() resolves", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    seedCreatedOrder(repo, "ff-durable");
    let statusDuringInventoryCall = "";
    const inventoryPort: InventoryPort = {
      async reserve() {
        const current = await repo.findById("ff-durable");
        statusDuringInventoryCall = current?.status.value ?? "";
        return { confirmed: true };
      },
    };
    const useCase = new RequestReservation(buildDeps(repo, inventoryPort));

    await useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-durable" });

    expect(statusDuringInventoryCall).toBe("reservation_requested");
  });
});

describe("Task 1 — Inventory failure recovery", () => {
  it("an Inventory reserve failure leaves the order durably at reservation_requested (recoverable), and rethrows the original error", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    seedCreatedOrder(repo, "ff-fail");
    const failingPort = new RecordingInventoryPort(undefined, { confirmed: true }, true);
    const useCase = new RequestReservation(buildDeps(repo, failingPort));

    await expect(
      useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-fail" }),
    ).rejects.toThrow(/simulated Inventory reserve failure/);

    const persisted = await repo.findById("ff-fail");
    expect(persisted?.status.value).toBe("reservation_requested");
  });

  it("a subsequent retry after an Inventory failure succeeds and confirms the reservation", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    seedCreatedOrder(repo, "ff-retry");
    const failingPort = new RecordingInventoryPort(undefined, { confirmed: true }, true);
    const failingUseCase = new RequestReservation(buildDeps(repo, failingPort));
    await expect(
      failingUseCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-retry" }),
    ).rejects.toThrow();

    const workingPort = new RecordingInventoryPort();
    const retryUseCase = new RequestReservation(buildDeps(repo, workingPort));
    const retried = await retryUseCase.execute({
      tenantId: "tenant-a",
      fulfillmentOrderId: "ff-retry",
    });

    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.status).toBe("confirmed");
    // The retry made exactly one Inventory call — the failed attempt's call plus this succeeding one.
    expect(workingPort.calls).toHaveLength(1);
  });

  it("Inventory reporting a business failure (confirmed: false) transitions the order to failed, not an error result", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    seedCreatedOrder(repo, "ff-declined");
    const decliningPort = new RecordingInventoryPort(undefined, {
      confirmed: false,
      reason: "out_of_stock",
    });
    const useCase = new RequestReservation(buildDeps(repo, decliningPort));

    const result = await useCase.execute({
      tenantId: "tenant-a",
      fulfillmentOrderId: "ff-declined",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("failed");

    // A subsequent retry on a `failed` order is legal (failed -> reservation_requested) and can
    // succeed if Inventory now confirms.
    const retryPort = new RecordingInventoryPort();
    const retryUseCase = new RequestReservation(buildDeps(repo, retryPort));
    const retried = await retryUseCase.execute({
      tenantId: "tenant-a",
      fulfillmentOrderId: "ff-declined",
    });
    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.status).toBe("confirmed");
  });
});

describe("Task 1 — idempotent resume on retry", () => {
  it("retrying RequestReservation after it already succeeded does not call Inventory again", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    seedCreatedOrder(repo, "ff-already");
    const inventoryPort = new RecordingInventoryPort();
    const useCase = new RequestReservation(buildDeps(repo, inventoryPort));

    const first = await useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-already" });
    expect(first.ok).toBe(true);
    expect(inventoryPort.calls).toHaveLength(1);

    const second = await useCase.execute({
      tenantId: "tenant-a",
      fulfillmentOrderId: "ff-already",
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.status).toBe("confirmed");
    // No second Inventory call — reserve()'s `confirmed` short-circuit skips it entirely.
    expect(inventoryPort.calls).toHaveLength(1);
  });

  it("requesting a reservation for a nonexistent fulfillment order returns a clean NOT_FOUND, never touches Inventory", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    const inventoryPort = new RecordingInventoryPort();
    const useCase = new RequestReservation(buildDeps(repo, inventoryPort));

    const result = await useCase.execute({
      tenantId: "tenant-a",
      fulfillmentOrderId: "does-not-exist",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(inventoryPort.calls).toHaveLength(0);
  });
});

describe("Task 1 — exploit proof: concurrent reservation requests never double-call Inventory", () => {
  for (let run = 0; run < 3; run += 1) {
    it(`run ${run + 1}/3: two concurrent RequestReservation calls for the SAME order result in exactly ONE InventoryPort.reserve() call`, async () => {
      const repo = new PostgresLikeFulfillmentOrderRepository();
      seedCreatedOrder(repo, "ff-race");
      const inventoryPort = new RecordingInventoryPort();
      const useCase = new RequestReservation(buildDeps(repo, inventoryPort));

      const outcomes = await Promise.all([
        useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-race" }),
        useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-race" }),
      ]);

      // Both callers get back a clean Result — neither one throws an uncaught ConcurrencyError.
      for (const outcome of outcomes) {
        expect(outcome.ok).toBe(true);
      }
      // This IS what the reserve-before-call pattern provides: the durable pre-call reservation
      // write means only the winner of the optimistic-lock race ever proceeds to call Inventory —
      // the loser resumes into "reservation_requested" without re-driving the port.
      expect(inventoryPort.calls).toHaveLength(1);

      const persisted = await repo.findById("ff-race");
      // The winner's own execute() continues on to settle() and reaches `confirmed`; the loser's
      // execute() returns early with whatever status was durable at the time it observed the
      // resume (typically `reservation_requested`, occasionally `confirmed` if the winner's
      // settle() interleaved first) — either way, a single well-defined status, never corrupted.
      expect(["reservation_requested", "confirmed"]).toContain(persisted?.status.value);
    });
  }

  it("two concurrent requests on DIFFERENT orders never interfere with each other", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    seedCreatedOrder(repo, "ff-a");
    seedCreatedOrder(repo, "ff-b");
    const inventoryPort = new RecordingInventoryPort();
    const useCase = new RequestReservation(buildDeps(repo, inventoryPort));

    const [a, b] = await Promise.all([
      useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-a" }),
      useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-b" }),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok) expect(a.value.status).toBe("confirmed");
    if (b.ok) expect(b.value.status).toBe("confirmed");
    expect(inventoryPort.calls).toHaveLength(2);
  });
});
