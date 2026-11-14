import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { Shipment } from "../domain/shipment";
import type { ShipmentRepository } from "../domain/shipment-repository";

/**
 * Test-only doubles shared by shipping's transaction-boundary and carrier suites (Phase A.15 shape,
 * moved out of `shipment-lifecycle-transaction-boundary.test.ts`).
 *
 * `TrackingUnitOfWork` counts currently-open `run()` calls, so a carrier double can prove whether
 * it was invoked while a transaction was open (A.14 §11).
 */
export class TrackingUnitOfWork implements TransactionalUnitOfWork<unknown> {
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

interface StoredRow {
  readonly shipment: Shipment;
  readonly version: number;
}

/**
 * Reproduces `PrismaShipmentRepository`'s contract without a database: rows are bucketed by tenant
 * (ADR-0014, so another tenant's id or tracking number is not found), `save()` throws
 * `ConcurrencyError` on a version mismatch, every read returns a freshly reconstituted instance
 * stamped with the row's current version (never one mutable object shared across reads), and the
 * fulfillment/tracking lookups return the newest row by creation, like `orderBy: { createdAt: "desc" }`.
 */
export class PostgresLikeShipmentRepository implements ShipmentRepository {
  private readonly rows = new Map<string, Map<string, StoredRow>>();

  save(shipment: Shipment, tenantId: string, _tx?: unknown): Promise<void> {
    const bucket = this.bucket(tenantId);
    const id = shipment.id.toString();
    const existing = bucket.get(id);
    if (existing === undefined) {
      bucket.set(id, { shipment, version: 1 });
      return Promise.resolve();
    }
    if (existing.version !== shipment.version) {
      return Promise.reject(
        new ConcurrencyError(
          `Shipment ${id} was modified concurrently (expected version ${shipment.version})`,
        ),
      );
    }
    bucket.set(id, { shipment, version: existing.version + 1 });
    return Promise.resolve();
  }

  findById(id: string, tenantId: string, _tx?: unknown): Promise<Shipment | null> {
    const row = this.bucket(tenantId).get(id);
    return Promise.resolve(row === undefined ? null : reconstitute(row));
  }

  findByIdempotencyKey(): Promise<Shipment | null> {
    return Promise.resolve(null);
  }

  findByFulfillmentRef(
    fulfillmentRef: string,
    tenantId: string,
    _tx?: unknown,
  ): Promise<Shipment | null> {
    return Promise.resolve(
      this.newest(tenantId, (shipment) => shipment.fulfillmentRef === fulfillmentRef),
    );
  }

  findByTrackingNumber(
    carrier: string,
    trackingNumber: string,
    tenantId: string,
    _tx?: unknown,
  ): Promise<Shipment | null> {
    return Promise.resolve(
      this.newest(
        tenantId,
        (shipment) =>
          shipment.carrier?.value === carrier && shipment.trackingNumber?.value === trackingNumber,
      ),
    );
  }

  /** Row count for one tenant, or across all tenants when `tenantId` is omitted. */
  size(tenantId?: string): number {
    if (tenantId !== undefined) return this.rows.get(tenantId)?.size ?? 0;
    let total = 0;
    for (const bucket of this.rows.values()) total += bucket.size;
    return total;
  }

  private bucket(tenantId: string): Map<string, StoredRow> {
    let bucket = this.rows.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.rows.set(tenantId, bucket);
    }
    return bucket;
  }

  /** `Map` keeps first-insertion order, so the last match is the most recently created row. */
  private newest(tenantId: string, matches: (shipment: Shipment) => boolean): Shipment | null {
    let found: StoredRow | undefined;
    for (const row of this.bucket(tenantId).values()) {
      if (matches(row.shipment)) found = row;
    }
    return found === undefined ? null : reconstitute(found);
  }
}

/** A fresh instance per read, mirroring a real DB round-trip. */
function reconstitute(row: StoredRow): Shipment {
  const s = row.shipment;
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
