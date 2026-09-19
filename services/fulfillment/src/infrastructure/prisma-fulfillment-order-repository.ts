import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { FulfillmentOrder } from "../domain/fulfillment-order";
import type { FulfillmentOrderRepository } from "../domain/fulfillment-order-repository";
import { FulfillmentOrderMapper } from "./fulfillment-order.mapper";

export interface PrismaFulfillmentOrderRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/**
 * Production `FulfillmentOrderRepository` on the `fulfillment` schema. Attempts are append-only
 * (`skipDuplicates`, PK = entity id — the observability trail is never rewritten). Optimistic
 * locking + same-transaction outbox per ADR-0003. Carrier data is a carrier-agnostic reference
 * only — no provider-specific columns.
 */
export class PrismaFulfillmentOrderRepository implements FulfillmentOrderRepository {
  private readonly deps: PrismaFulfillmentOrderRepositoryDeps;

  constructor(deps: PrismaFulfillmentOrderRepositoryDeps) {
    this.deps = deps;
  }

  async save(fulfillmentOrder: FulfillmentOrder, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const fulfillmentOrderId = fulfillmentOrder.id.toString();
    const row = FulfillmentOrderMapper.toRow(fulfillmentOrder, tenantId);

    if (fulfillmentOrder.version === 0) {
      await client.fulfillmentOrder.create({
        data: {
          ...row,
          items: row.items,
          carrierReference: row.carrierReference,
          packages: row.packages,
        },
      });
    } else {
      const updated = await client.fulfillmentOrder.updateMany({
        where: { id: fulfillmentOrderId, tenantId, version: fulfillmentOrder.version },
        data: {
          status: row.status,
          carrierReference: row.carrierReference,
          trackingNumber: row.trackingNumber,
          packages: row.packages,
          deliveredAt: row.deliveredAt,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `FulfillmentOrder ${fulfillmentOrderId} was modified concurrently (expected version ${fulfillmentOrder.version})`,
        );
      }
    }

    const attempts = FulfillmentOrderMapper.toAttemptRows(fulfillmentOrder, tenantId);
    if (attempts.length > 0) {
      await client.fulfillmentAttempt.createMany({ data: attempts, skipDuplicates: true });
    }

    await this.deps.outbox.write(
      fulfillmentOrder.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<FulfillmentOrder | null> {
    return this.findOne({ id, tenantId }, tenantId, tx);
  }

  async findByOrderRef(
    orderRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<FulfillmentOrder | null> {
    return this.findOne({ orderRef, tenantId }, tenantId, tx);
  }

  private async findOne(
    where: { readonly tenantId: string } & Record<string, string>,
    tenantId: string,
    tx: unknown,
  ): Promise<FulfillmentOrder | null> {
    const run = (client: TransactionClient) =>
      client.fulfillmentOrder.findFirst({
        where,
        include: { attempts: { orderBy: { occurredAt: "asc" } } },
      });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    if (row === null) return null;
    return FulfillmentOrderMapper.toDomain(
      {
        ...row,
        items: row.items as { productRef: string; quantity: number }[],
        carrierReference: row.carrierReference as {
          carrier: string;
          carrierShipmentId: string;
        },
        // Array-of-objects JSON columns need the `unknown` hop: Prisma's `JsonValue` union has no
        // structural overlap with a concrete element shape (comparability fails, not just assignability).
        packages: row.packages as unknown as {
          reference: string;
          itemRefs: readonly string[];
          weightGrams: number;
        }[],
      },
      row.attempts,
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaFulfillmentOrderRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
