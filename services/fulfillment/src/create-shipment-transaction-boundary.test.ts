import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { FulfillmentOrder } from "./domain/fulfillment-order";
import type { FulfillmentOrderRepository } from "./domain/fulfillment-order-repository";
import { FulfillmentItem } from "./domain/value-objects/fulfillment-item";
import { CreateShipment, type CreateShipmentDeps } from "./application/create-shipment.use-case";
import type {
  CreateShipmentRequest,
  ProviderShipment,
  ShippingProviderPort,
} from "./application/ports";
import {
  FulfillmentOrderMapper,
  type FulfillmentOrderRow,
} from "./infrastructure/fulfillment-order.mapper";

/**
 * Phase A.15 (Task 2) — same fake shapes as the Payments Phase A.13/A.8 transaction-boundary tests
 * (`create-intent-transaction-boundary.test.ts` / `capture-concurrency.test.ts`): a Postgres-like
 * repository that reproduces `PrismaFulfillmentOrderRepository`'s optimistic-lock (`version`)
 * contract, and a `TrackingUnitOfWork` that counts currently-open `run()` calls so a
 * `ShippingProviderPort` can prove whether it was invoked while a transaction was open.
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

class RecordingShippingProvider implements ShippingProviderPort {
  readonly calls: Array<{ idempotencyKey: string; openCountAtCall: number }> = [];
  private readonly seenKeys = new Set<string>();
  realEffects = 0;
  private counter = 0;

  constructor(
    private readonly uow?: TrackingUnitOfWork,
    private readonly failAlways = false,
    private readonly withTracking = true,
  ) {}

  async createShipment(request: CreateShipmentRequest): Promise<ProviderShipment> {
    this.calls.push({
      idempotencyKey: request.idempotencyKey,
      openCountAtCall: this.uow?.openCount ?? -1,
    });
    if (this.failAlways) {
      throw new Error("simulated carrier createShipment failure");
    }
    this.counter += 1;
    if (!this.seenKeys.has(request.idempotencyKey)) {
      this.seenKeys.add(request.idempotencyKey);
      this.realEffects += 1;
    }
    return {
      carrier: "ups",
      carrierShipmentId: `carrier-${request.idempotencyKey}`,
      trackingNumber: this.withTracking ? `track-${this.counter}` : undefined,
    };
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

/** A fulfillment order already advanced to `packing_completed` — the only status `createShipment()` accepts. */
function seedPackingCompletedOrder(repo: PostgresLikeFulfillmentOrderRepository, id: string): void {
  const order = FulfillmentOrder.create(UniqueEntityId.from(id), `order-${id}`, [item()]);
  order.requestReservation("seed-1", new Date(0));
  order.confirmReservation("seed-2", new Date(0));
  order.startPicking("seed-3", new Date(0));
  order.completePicking("seed-4", new Date(0));
  order.startPacking("seed-5", new Date(0));
  order.completePacking("seed-6", new Date(0));
  order.pullDomainEvents();
  repo.seed(order);
}

function buildDeps(
  repo: FulfillmentOrderRepository,
  shippingProvider: ShippingProviderPort,
  unitOfWork: TransactionalUnitOfWork<unknown> = new PassthroughUnitOfWork(),
): CreateShipmentDeps {
  return {
    fulfillmentOrders: repo,
    unitOfWork,
    idGenerator: sequentialIds("evt"),
    clock,
    shippingProvider,
  };
}

describe("Task 2 — exploit proof: the carrier call happens while a DB transaction is open", () => {
  it("EXPLOIT (pre-fix shape): would show ShippingProviderPort.createShipment() invoked with a transaction still open (openCount > 0)", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    seedPackingCompletedOrder(repo, "ff-tx");
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingShippingProvider(uow);
    const useCase = new CreateShipment(buildDeps(repo, provider, uow));

    const result = await useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-tx" });

    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    // Fixed behavior: no transaction should be open while the carrier network call is in flight.
    expect(provider.calls[0]?.openCountAtCall).toBe(0);
    if (result.ok) expect(result.value.status).toBe("tracking_assigned");
  });
});

describe("Task 2 — carrier failure recovery", () => {
  it("a carrier createShipment failure leaves the order at packing_completed (unchanged), and rethrows the original error", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    seedPackingCompletedOrder(repo, "ff-fail");
    const failingProvider = new RecordingShippingProvider(undefined, true);
    const useCase = new CreateShipment(buildDeps(repo, failingProvider));

    await expect(
      useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-fail" }),
    ).rejects.toThrow(/simulated carrier createShipment failure/);

    const persisted = await repo.findById("ff-fail");
    expect(persisted?.status.value).toBe("packing_completed");
  });

  it("a subsequent retry after a carrier failure succeeds and completes the shipment", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    seedPackingCompletedOrder(repo, "ff-retry");
    const failingProvider = new RecordingShippingProvider(undefined, true);
    const failingUseCase = new CreateShipment(buildDeps(repo, failingProvider));
    await expect(
      failingUseCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-retry" }),
    ).rejects.toThrow();

    const workingProvider = new RecordingShippingProvider();
    const retryUseCase = new CreateShipment(buildDeps(repo, workingProvider));
    const retried = await retryUseCase.execute({
      tenantId: "tenant-a",
      fulfillmentOrderId: "ff-retry",
    });

    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.status).toBe("tracking_assigned");
  });
});

describe("Task 2 — idempotent resume on retry", () => {
  it("retrying CreateShipment after it already succeeded does not call the carrier again", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    seedPackingCompletedOrder(repo, "ff-already");
    // No tracking number this time: the order settles at `shipment_created` (not `tracking_assigned`)
    // so the retry lands squarely on precheck's `alreadyShipped` short-circuit being exercised.
    const provider = new RecordingShippingProvider(undefined, false, false);
    const useCase = new CreateShipment(buildDeps(repo, provider));

    const first = await useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-already" });
    expect(first.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);

    const second = await useCase.execute({
      tenantId: "tenant-a",
      fulfillmentOrderId: "ff-already",
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.status).toBe("shipment_created");
    // No second carrier call — precheck's `alreadyShipped` short-circuit skips it entirely.
    expect(provider.calls).toHaveLength(1);
  });

  it("shipping a nonexistent fulfillment order returns a clean NOT_FOUND, never touches the carrier", async () => {
    const repo = new PostgresLikeFulfillmentOrderRepository();
    const provider = new RecordingShippingProvider();
    const useCase = new CreateShipment(buildDeps(repo, provider));

    const result = await useCase.execute({
      tenantId: "tenant-a",
      fulfillmentOrderId: "does-not-exist",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(provider.calls).toHaveLength(0);
  });
});

describe("Task 2 — concurrent CreateShipment calls for the same order (documented residual risk)", () => {
  for (let run = 0; run < 3; run += 1) {
    it(`run ${run + 1}/3: both concurrent calls resolve cleanly — exactly one durable shipment_created transition, the loser (if any) gets a clean domain error, never an uncaught exception`, async () => {
      const repo = new PostgresLikeFulfillmentOrderRepository();
      seedPackingCompletedOrder(repo, "ff-race");
      // Same idempotencyKey for both calls (`${id}:shipment`) — a real carrier would dedupe the
      // physical call too; this fake models that via `realEffects`.
      const provider = new RecordingShippingProvider();
      const useCase = new CreateShipment(buildDeps(repo, provider));

      const outcomes = await Promise.allSettled([
        useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-race" }),
        useCase.execute({ tenantId: "tenant-a", fulfillmentOrderId: "ff-race" }),
      ]);

      // Desired/safe behavior: neither call rejects with an uncaught exception.
      for (const outcome of outcomes) {
        expect(outcome.status).toBe("fulfilled");
      }
      const results = outcomes.map((o) => (o.status === "fulfilled" ? o.value : null));
      const okCount = results.filter((r) => r?.ok === true).length;
      // Exactly one caller wins the durable transition (the other's settle() finds the order
      // already advanced past `packing_completed` and cleanly returns a domain error).
      expect(okCount).toBe(1);

      const persisted = await repo.findById("ff-race");
      expect(["shipment_created", "tracking_assigned"]).toContain(persisted?.status.value);
      // Documented residual risk: precheck is a plain read, so BOTH callers may have physically
      // called the carrier (up to 2 calls) — but the carrier's own idempotency key collapses it to
      // one real effect, exactly like a real dedupe-capable PSP would.
      expect(provider.calls.length).toBeGreaterThanOrEqual(1);
      expect(provider.calls.length).toBeLessThanOrEqual(2);
      expect(provider.realEffects).toBe(1);
    });
  }
});
