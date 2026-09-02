import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { Shipment } from "../domain/shipment";
import type { ShipmentRepository } from "../domain/shipment-repository";
import { ShipmentMapper } from "./shipment.mapper";

export interface PrismaShipmentRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/**
 * Production `ShipmentRepository` on the `shipping` schema. Attempts are append-only
 * (`skipDuplicates`, PK = entity id — the observability trail is never rewritten). Optimistic
 * locking + same-transaction outbox per ADR-0003. Carrier data is carrier-agnostic — no
 * provider-specific columns, no label bytes/rate/PII (G-27).
 */
export class PrismaShipmentRepository implements ShipmentRepository {
  private readonly deps: PrismaShipmentRepositoryDeps;

  constructor(deps: PrismaShipmentRepositoryDeps) {
    this.deps = deps;
  }

  async save(shipment: Shipment, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
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

    await this.deps.outbox.write(shipment.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Shipment | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.shipment.findFirst({
      where: { id, tenantId: this.deps.tenantId },
      include: { attempts: { orderBy: { occurredAt: "asc" } } },
    });
    if (row === null) return null;
    return ShipmentMapper.toDomain(
      {
        ...row,
        // Array-of-objects JSON columns need the `unknown` hop: Prisma's `JsonValue` union has no
        // structural overlap with a concrete element shape (comparability fails, not just assignability).
        packages: row.packages as unknown as {
          reference: string;
          itemRefs: readonly string[];
          weightGrams: number;
        }[],
        label: row.label as { labelId: string; trackingNumber: string },
        trackingEvents: row.trackingEvents as {
          id: string;
          description: string;
          location: string | null;
          occurredAt: string;
        }[],
        deliveryEstimate: row.deliveryEstimate as {
          windowStart: string;
          windowEnd: string;
        },
      },
      row.attempts,
    );
  }

  /** Scaffolding for retry-safe saga-activity idempotency (Sprint A0 precondition); not yet called by any use case. */
  async findByIdempotencyKey(idempotencyKey: string, tx?: unknown): Promise<Shipment | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.shipment.findFirst({
      where: { idempotencyKey, tenantId: this.deps.tenantId },
      include: { attempts: { orderBy: { occurredAt: "asc" } } },
    });
    if (row === null) return null;
    return ShipmentMapper.toDomain(
      {
        ...row,
        // Array-of-objects JSON columns need the `unknown` hop: Prisma's `JsonValue` union has no
        // structural overlap with a concrete element shape (comparability fails, not just assignability).
        packages: row.packages as unknown as {
          reference: string;
          itemRefs: readonly string[];
          weightGrams: number;
        }[],
        label: row.label as { labelId: string; trackingNumber: string },
        trackingEvents: row.trackingEvents as {
          id: string;
          description: string;
          location: string | null;
          occurredAt: string;
        }[],
        deliveryEstimate: row.deliveryEstimate as {
          windowStart: string;
          windowEnd: string;
        },
      },
      row.attempts,
    );
  }

  async findByFulfillmentRef(fulfillmentRef: string, tx?: unknown): Promise<Shipment | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.shipment.findFirst({
      where: { fulfillmentRef, tenantId: this.deps.tenantId },
      include: { attempts: { orderBy: { occurredAt: "asc" } } },
    });
    if (row === null) return null;
    return ShipmentMapper.toDomain(
      {
        ...row,
        packages: row.packages as unknown as {
          reference: string;
          itemRefs: readonly string[];
          weightGrams: number;
        }[],
        label: row.label as { labelId: string; trackingNumber: string },
        trackingEvents: row.trackingEvents as {
          id: string;
          description: string;
          location: string | null;
          occurredAt: string;
        }[],
        deliveryEstimate: row.deliveryEstimate as {
          windowStart: string;
          windowEnd: string;
        },
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
