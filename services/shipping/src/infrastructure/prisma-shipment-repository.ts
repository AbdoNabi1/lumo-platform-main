import { runReadScoped, type Database, type Prisma, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { Shipment } from "../domain/shipment";
import type { ShipmentRepository } from "../domain/shipment-repository";
import {
  type DeliveryEstimateJson,
  ShipmentMapper,
  type ShipmentPackageJson,
  type ShippingLabelJson,
  type TrackingEventJson,
} from "./shipment.mapper";

type ShipmentRecord = Prisma.ShipmentGetPayload<{ include: { attempts: true } }>;

export interface PrismaShipmentRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/**
 * Production `ShipmentRepository` on the `shipping` schema. Attempts are append-only
 * (`skipDuplicates`, PK = entity id — the observability trail is never rewritten). Optimistic
 * locking + same-transaction outbox per ADR-0003. Carrier data is carrier-agnostic — no
 * provider-specific columns, no label bytes/rate/PII (G-27).
 */
/** ADR-0014: reuse the caller's `tx` if given, else scope the read via `runReadScoped`. */
function readScoped<T>(
  prisma: Database,
  tenantId: string,
  tx: unknown,
  run: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  return tx !== undefined && tx !== null
    ? run(tx as TransactionClient)
    : runReadScoped(prisma, tenantId, run);
}

export class PrismaShipmentRepository implements ShipmentRepository {
  private readonly deps: PrismaShipmentRepositoryDeps;

  constructor(deps: PrismaShipmentRepositoryDeps) {
    this.deps = deps;
  }

  async save(shipment: Shipment, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const shipmentId = shipment.id.toString();
    const row = ShipmentMapper.toRow(shipment, tenantId);

    if (shipment.version === 0) {
      await client.shipment.create({
        data: {
          ...row,
          packages: row.packages,
          label: row.label,
          trackingEvents: row.trackingEvents,
          deliveryEstimate: row.deliveryEstimate,
        },
      });
    } else {
      const updated = await client.shipment.updateMany({
        where: { id: shipmentId, tenantId, version: shipment.version },
        data: {
          status: row.status,
          carrier: row.carrier,
          carrierService: row.carrierService,
          label: row.label,
          trackingNumber: row.trackingNumber,
          trackingEvents: row.trackingEvents,
          deliveryEstimate: row.deliveryEstimate,
          deliveredAt: row.deliveredAt,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Shipment ${shipmentId} was modified concurrently (expected version ${shipment.version})`,
        );
      }
    }

    const attempts = ShipmentMapper.toAttemptRows(shipment, tenantId);
    if (attempts.length > 0) {
      await client.shippingAttempt.createMany({ data: attempts, skipDuplicates: true });
    }

    await this.deps.outbox.write(
      shipment.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<Shipment | null> {
    const row = await readScoped(this.deps.prisma, tenantId, tx, (client) =>
      client.shipment.findFirst({
        where: { id, tenantId },
        include: { attempts: { orderBy: { occurredAt: "asc" } } },
      }),
    );
    return row === null ? null : this.toDomain(row);
  }

  /** Scaffolding for retry-safe saga-activity idempotency (Sprint A0 precondition); not yet called by any use case. */
  async findByIdempotencyKey(
    idempotencyKey: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Shipment | null> {
    const row = await readScoped(this.deps.prisma, tenantId, tx, (client) =>
      client.shipment.findFirst({
        where: { idempotencyKey, tenantId },
        include: { attempts: { orderBy: { occurredAt: "asc" } } },
      }),
    );
    return row === null ? null : this.toDomain(row);
  }

  /** Newest first (F4): a carrier-cancelled shipment's replacement is the one the order uses. */
  async findByFulfillmentRef(
    fulfillmentRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Shipment | null> {
    const row = await readScoped(this.deps.prisma, tenantId, tx, (client) =>
      client.shipment.findFirst({
        where: { fulfillmentRef, tenantId },
        include: { attempts: { orderBy: { occurredAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      }),
    );
    return row === null ? null : this.toDomain(row);
  }

  countByFulfillmentRef(fulfillmentRef: string, tenantId: string, tx?: unknown): Promise<number> {
    return readScoped(this.deps.prisma, tenantId, tx, (client) =>
      client.shipment.count({ where: { tenantId, fulfillmentRef } }),
    );
  }

  async findByTrackingNumber(
    carrier: string,
    trackingNumber: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Shipment | null> {
    const row = await readScoped(this.deps.prisma, tenantId, tx, (client) =>
      client.shipment.findFirst({
        where: { tenantId, carrier, trackingNumber },
        include: { attempts: { orderBy: { occurredAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      }),
    );
    return row === null ? null : this.toDomain(row);
  }

  private toDomain(row: ShipmentRecord): Shipment {
    return ShipmentMapper.toDomain(
      {
        ...row,
        // Array-of-objects JSON columns need the `unknown` hop: Prisma's `JsonValue` union has no
        // structural overlap with a concrete element shape (comparability fails, not just assignability).
        packages: row.packages as unknown as ShipmentPackageJson[],
        label: row.label as unknown as ShippingLabelJson,
        trackingEvents: row.trackingEvents as unknown as TrackingEventJson[],
        deliveryEstimate: row.deliveryEstimate as unknown as DeliveryEstimateJson,
      },
      row.attempts,
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaShipmentRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
