import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { Shipment } from "./domain/shipment";
import type { ShipmentRepository } from "./domain/shipment-repository";
import { Carrier, CarrierService } from "./domain/value-objects/carrier";
import { ShipmentPackage } from "./domain/value-objects/shipment-package";
import { ShippingLabel } from "./domain/value-objects/shipping-label";
import { TrackingNumber } from "./domain/value-objects/tracking-number";
import {
  CreateLabel,
  type CreateLabelDeps,
  VoidLabel,
  type VoidLabelDeps,
} from "./application/shipment-lifecycle.use-cases";
import type {
  CarrierProviderPort,
  CreateLabelRequest,
  ProviderLabel,
  VoidLabelRequest,
} from "./application/ports";

/**
 * Phase A.15 (Shipping, Task 1-2) — same exploit-proof shape as Payments' Phase A.13
 * `create-intent-transaction-boundary.test.ts` and Licensing's Phase A.15
 * `collect-invoice-transaction-boundary.test.ts`: a `TrackingUnitOfWork` counts currently-open
 * `run()` calls so `CarrierProviderPort.createLabel()`/`voidLabel()` can prove whether they were
 * invoked while a transaction was open (A.14 §11), and a `PostgresLikeShipmentRepository` fake
 * reproduces `PrismaShipmentRepository`'s optimistic-lock (`version`) contract: `save()` throws
 * `ConcurrencyError` on a version mismatch, and `findById()` always returns a freshly reconstituted
 * instance stamped with the row's current version (never the same in-memory object mutated across
 * reads), exactly like a real DB round-trip.
 */
const TENANT = "tenant-a";

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

class PostgresLikeShipmentRepository implements ShipmentRepository {
  private readonly rows = new Map<string, { shipment: Shipment; version: number }>();

  async save(shipment: Shipment, _tenantId: string, _tx?: unknown): Promise<void> {
    const id = shipment.id.toString();
    const existing = this.rows.get(id);
    if (existing === undefined) {
      this.rows.set(id, { shipment, version: 1 });
      return;
    }
    if (existing.version !== shipment.version) {
      throw new ConcurrencyError(
        `Shipment ${id} was modified concurrently (expected version ${shipment.version})`,
      );
    }
    this.rows.set(id, { shipment, version: existing.version + 1 });
  }

  async findById(id: string, _tenantId: string, _tx?: unknown): Promise<Shipment | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null;
    const s = row.shipment;
    // Reconstitute fresh (mirrors a real DB round-trip: every read is an independent instance
    // stamped with the row's current version) — this is what makes the concurrency test below
    // meaningful rather than trivially sharing one mutable object across "reads".
    return Shipment.reconstitute(s.id, s.fulfillmentRef, s.packages, s.status, row.version, {
      attempts: s.attempts,
      trackingEvents: s.trackingEvents,
      carrier: s.carrier,
      carrierService: s.carrierService,
      label: s.label,
      trackingNumber: s.trackingNumber,
      deliveryEstimate: s.deliveryEstimate,
      deliveredAt: s.deliveredAt,
    });
  }

  async findByIdempotencyKey(): Promise<Shipment | null> {
    return null;
  }

  async findByFulfillmentRef(fulfillmentRef: string): Promise<Shipment | null> {
    for (const row of this.rows.values()) {
      if (row.shipment.fulfillmentRef === fulfillmentRef) return row.shipment;
    }
    return null;
  }

  size(): number {
    return this.rows.size;
  }
}

class RecordingCarrierProvider implements CarrierProviderPort {
  readonly createLabelCalls: Array<{ request: CreateLabelRequest; openCountAtCall: number }> = [];
  readonly voidLabelCalls: Array<{ request: VoidLabelRequest; openCountAtCall: number }> = [];
  private counter = 0;

  constructor(
    private readonly uow?: TrackingUnitOfWork,
    private readonly failCreate = false,
    private readonly failVoid = false,
    private readonly delayMs = 0,
  ) {}

  async createLabel(request: CreateLabelRequest): Promise<ProviderLabel> {
    this.createLabelCalls.push({ request, openCountAtCall: this.uow?.openCount ?? -1 });
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failCreate) throw new Error("simulated carrier createLabel failure");
    this.counter += 1;
    return {
      carrier: "ups",
      carrierService: "ground",
      labelId: `label-${this.counter}`,
      trackingNumber: `track-${this.counter}`,
    };
  }

  async voidLabel(request: VoidLabelRequest): Promise<void> {
    this.voidLabelCalls.push({ request, openCountAtCall: this.uow?.openCount ?? -1 });
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failVoid) throw new Error("simulated carrier voidLabel failure");
  }
}

let idCounter = 0;
function sequentialIds(prefix: string): IdGenerator {
  return { generate: () => `${prefix}-${(idCounter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-08-12T00:00:00.000Z") };

function buildCreateLabelDeps(
  shipments: ShipmentRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  carrierProvider: CarrierProviderPort,
): CreateLabelDeps {
  return { shipments, unitOfWork, idGenerator: sequentialIds("evt"), clock, carrierProvider };
}

function buildVoidLabelDeps(
  shipments: ShipmentRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  carrierProvider: CarrierProviderPort,
): VoidLabelDeps {
  return { shipments, unitOfWork, idGenerator: sequentialIds("evt"), clock, carrierProvider };
}

function packages(): readonly ShipmentPackage[] {
  const pkg = ShipmentPackage.create("pkg-1", ["item-1"], 500);
  if (!pkg.ok) throw new Error("test fixture: invalid package");
  return [pkg.value];
}

async function seedCreatedShipment(shipments: ShipmentRepository, id: string): Promise<void> {
  const shipment = Shipment.create(UniqueEntityId.from(id), "fulfillment-1", packages());
  await shipments.save(shipment, TENANT);
}

async function seedLabeledShipment(shipments: ShipmentRepository, id: string): Promise<void> {
  await seedCreatedShipment(shipments, id);
  const shipment = await shipments.findById(id, TENANT);
  if (shipment === null) throw new Error("test fixture: seed failed");
  const labelVo = ShippingLabel.create("label-seed", "track-seed");
  const carrierVo = Carrier.create("ups");
  const carrierServiceVo = CarrierService.create("ground");
  const trackingVo = TrackingNumber.create("track-seed");
  if (!labelVo.ok || !carrierVo.ok || !carrierServiceVo.ok || !trackingVo.ok) {
    throw new Error("test fixture: invalid seed label VOs");
  }
  shipment.createLabel(
    labelVo.value,
    carrierVo.value,
    carrierServiceVo.value,
    trackingVo.value,
    "evt-seed-label",
    clock.now(),
  );
  await shipments.save(shipment, TENANT);
}

describe("Task 1/2 — exploit proof: carrier createLabel()/voidLabel() run while a DB transaction is open", () => {
  it("EXPLOIT (pre-fix shape): would show createLabel() invoked with a transaction still open", async () => {
    const shipments = new PostgresLikeShipmentRepository();
    await seedCreatedShipment(shipments, "ship-1");
    const uow = new TrackingUnitOfWork();
    const carrier = new RecordingCarrierProvider(uow);
    const useCase = new CreateLabel(buildCreateLabelDeps(shipments, uow, carrier));

    const result = await useCase.execute({ tenantId: TENANT, shipmentId: "ship-1" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("label_created");
    expect(carrier.createLabelCalls).toHaveLength(1);
    // Fixed behavior: no transaction is open while the carrier network call is in flight.
    expect(carrier.createLabelCalls[0]?.openCountAtCall).toBe(0);
  });

  it("EXPLOIT (pre-fix shape): would show voidLabel() invoked with a transaction still open", async () => {
    const shipments = new PostgresLikeShipmentRepository();
    await seedLabeledShipment(shipments, "ship-2");
    const uow = new TrackingUnitOfWork();
    const carrier = new RecordingCarrierProvider(uow);
    const useCase = new VoidLabel(buildVoidLabelDeps(shipments, uow, carrier));

    const result = await useCase.execute({ tenantId: TENANT, shipmentId: "ship-2" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("voided");
    expect(carrier.voidLabelCalls).toHaveLength(1);
    expect(carrier.voidLabelCalls[0]?.openCountAtCall).toBe(0);
  });

  it("the precheck's read is durably committed before the carrier call resolves (createLabel)", async () => {
    const shipments = new PostgresLikeShipmentRepository();
    await seedCreatedShipment(shipments, "ship-3");
    const uow = new TrackingUnitOfWork();
    let sizeDuringCarrierCall = -1;
    const carrier: CarrierProviderPort = {
      async createLabel() {
        sizeDuringCarrierCall = shipments.size();
        return {
          carrier: "ups",
          carrierService: "ground",
          labelId: "label-x",
          trackingNumber: "track-x",
        };
      },
      async voidLabel() {},
    };
    const useCase = new CreateLabel(buildCreateLabelDeps(shipments, uow, carrier));

    await useCase.execute({ tenantId: TENANT, shipmentId: "ship-3" });

    expect(sizeDuringCarrierCall).toBe(1);
  });
});

describe("Task 1/2 — carrier-call failure recovery", () => {
  it("a carrier createLabel() failure leaves the shipment at 'created' (unchanged) and rethrows the original error", async () => {
    const shipments = new PostgresLikeShipmentRepository();
    await seedCreatedShipment(shipments, "ship-fail-1");
    const uow = new TrackingUnitOfWork();
    const carrier = new RecordingCarrierProvider(uow, true);
    const useCase = new CreateLabel(buildCreateLabelDeps(shipments, uow, carrier));

    // Reasoning (documented per the class doc comment): `precheck()` is a plain read that never
    // mutates the shipment — there is no intermediate "label_requested" status to reserve and no
    // in-flight state to unwind on failure. So the correct recovery is simply: nothing changed,
    // rethrow. This mirrors exactly what the pre-fix single-transaction version did on rollback.
    await expect(useCase.execute({ tenantId: TENANT, shipmentId: "ship-fail-1" })).rejects.toThrow(
      /simulated carrier createLabel failure/,
    );

    const persisted = await shipments.findById("ship-fail-1", TENANT);
    expect(persisted?.status.value).toBe("created");
    expect(persisted?.label).toBeUndefined();
  });

  it("a carrier voidLabel() failure leaves the shipment at 'label_created' (unchanged) and rethrows the original error", async () => {
    const shipments = new PostgresLikeShipmentRepository();
    await seedLabeledShipment(shipments, "ship-fail-2");
    const uow = new TrackingUnitOfWork();
    const carrier = new RecordingCarrierProvider(uow, false, true);
    const useCase = new VoidLabel(buildVoidLabelDeps(shipments, uow, carrier));

    await expect(useCase.execute({ tenantId: TENANT, shipmentId: "ship-fail-2" })).rejects.toThrow(
      /simulated carrier voidLabel failure/,
    );

    const persisted = await shipments.findById("ship-fail-2", TENANT);
    expect(persisted?.status.value).toBe("label_created");
  });
});

describe("Task 1/2 — idempotent resume", () => {
  it("a retried CreateLabel.execute() against an already-label_created shipment does not re-call the carrier", async () => {
    const shipments = new PostgresLikeShipmentRepository();
    await seedCreatedShipment(shipments, "ship-idem-1");
    const uow = new TrackingUnitOfWork();
    const carrier = new RecordingCarrierProvider(uow);
    const useCase = new CreateLabel(buildCreateLabelDeps(shipments, uow, carrier));

    const first = await useCase.execute({ tenantId: TENANT, shipmentId: "ship-idem-1" });
    const second = await useCase.execute({ tenantId: TENANT, shipmentId: "ship-idem-1" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.status).toBe("label_created");
    expect(carrier.createLabelCalls).toHaveLength(1);
  });

  it("a retried VoidLabel.execute() against an already-voided shipment does not re-call the carrier", async () => {
    const shipments = new PostgresLikeShipmentRepository();
    await seedLabeledShipment(shipments, "ship-idem-2");
    const uow = new TrackingUnitOfWork();
    const carrier = new RecordingCarrierProvider(uow);
    const useCase = new VoidLabel(buildVoidLabelDeps(shipments, uow, carrier));

    const first = await useCase.execute({ tenantId: TENANT, shipmentId: "ship-idem-2" });
    const second = await useCase.execute({ tenantId: TENANT, shipmentId: "ship-idem-2" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.status).toBe("voided");
    expect(carrier.voidLabelCalls).toHaveLength(1);
  });
});

describe("Task 1/2 — concurrent-call behavior", () => {
  it(
    "two concurrent CreateLabel.execute() calls against the same shipment converge on one " +
      "persisted 'label_created' row without a lost update or an uncaught ConcurrencyError " +
      "(CHARACTERIZATION, not a full double-carrier-call safety proof — see comment below)",
    async () => {
      for (let run = 0; run < 3; run += 1) {
        const shipments = new PostgresLikeShipmentRepository();
        await seedCreatedShipment(shipments, "ship-concurrent");
        const uow = new TrackingUnitOfWork();
        // Small delay so both concurrent calls' precheck reads interleave before either settles —
        // reproducing the race window a real DB round-trip would have.
        const carrier = new RecordingCarrierProvider(uow, false, false, 1);
        const useCaseA = new CreateLabel(buildCreateLabelDeps(shipments, uow, carrier));
        const useCaseB = new CreateLabel(buildCreateLabelDeps(shipments, uow, carrier));

        const [a, b] = await Promise.all([
          useCaseA.execute({ tenantId: TENANT, shipmentId: "ship-concurrent" }),
          useCaseB.execute({ tenantId: TENANT, shipmentId: "ship-concurrent" }),
        ]);

        // Neither call result leaks an uncaught ConcurrencyError to the caller — `withConcurrencyRetry`
        // absorbs the loser's optimistic-lock conflict and retries against the now-current row.
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (a.ok) expect(a.value.status).toBe("label_created");
        if (b.ok) expect(b.value.status).toBe("label_created");
        expect(shipments.size()).toBe(1); // one row, not a duplicate/corrupted write

        // HONEST CONCLUSION (unlike Licensing's `CollectInvoice.collect()`, which carries no
        // idempotency key at all): `createLabel()` IS called with a deterministic idempotency key
        // (`${shipmentId}:label`) on every call, precheck or not. `precheck()` here is still a plain
        // read with no durable reservation write, so — exactly like `CollectInvoice` — both racing
        // callers can legitimately observe "created" and both proceed to call
        // `carrierProvider.createLabel()` (this test's `carrier.createLabelCalls.length` can be 1 or
        // 2 depending on interleaving; both are valid outcomes here and are not asserted strictly).
        // The materially smaller residual risk versus Licensing is that the *carrier itself* is
        // contractually obligated to dedupe by that idempotency key (per `CreateLabelRequest`'s own
        // doc comment: "a repeated call with the same key must not create a second label at the
        // carrier") — so even when both callers do reach the network call, a real carrier should not
        // issue two labels. This test's in-memory `RecordingCarrierProvider` does NOT enforce that
        // dedupe itself (it always mints a fresh label), so it cannot prove the carrier-side
        // contract holds — it only proves Shipping's own write path stays safe under the race.
        expect(carrier.createLabelCalls.length).toBeGreaterThanOrEqual(1);
        expect(carrier.createLabelCalls.length).toBeLessThanOrEqual(2);
      }
    },
  );

  it(
    "two concurrent VoidLabel.execute() calls against the same shipment converge on one " +
      "persisted 'voided' row without a lost update or an uncaught ConcurrencyError " +
      "(same characterization as CreateLabel above)",
    async () => {
      for (let run = 0; run < 3; run += 1) {
        const shipments = new PostgresLikeShipmentRepository();
        await seedLabeledShipment(shipments, "ship-void-concurrent");
        const uow = new TrackingUnitOfWork();
        const carrier = new RecordingCarrierProvider(uow, false, false, 1);
        const useCaseA = new VoidLabel(buildVoidLabelDeps(shipments, uow, carrier));
        const useCaseB = new VoidLabel(buildVoidLabelDeps(shipments, uow, carrier));

        const [a, b] = await Promise.all([
          useCaseA.execute({ tenantId: TENANT, shipmentId: "ship-void-concurrent" }),
          useCaseB.execute({ tenantId: TENANT, shipmentId: "ship-void-concurrent" }),
        ]);

        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (a.ok) expect(a.value.status).toBe("voided");
        if (b.ok) expect(b.value.status).toBe("voided");
        expect(shipments.size()).toBe(1);
        expect(carrier.voidLabelCalls.length).toBeGreaterThanOrEqual(1);
        expect(carrier.voidLabelCalls.length).toBeLessThanOrEqual(2);
      }
    },
  );
});
