import type { IdGenerator } from "@platform/contracts";
import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { ConsentProjectionRecord, ConsentProjectionStore } from "../application/ports";

export interface PrismaConsentProjectionDeps {
  readonly prisma: Database;
  readonly idGenerator: IdGenerator;
}

/**
 * Postgres-backed {@link ConsentProjectionStore} (H-2, G-SEC-4) — the durable consent projection the
 * production {@link ProjectionConsentPort} reads and the {@link ConsentChangedConsumer} writes. Every
 * row is tenant-scoped (ADR-0008); the `(tenant_id, subject_ref, purpose)` unique index is the
 * projection key. `upsert` is **last-writer-wins by `occurredAt`**: an incoming decision only replaces a
 * strictly-older stored one, so out-of-order / redelivered events converge and never regress. Identity
 * remains the owner of consent — this is a read copy, never a second source of truth.
 */
export class PrismaConsentProjectionStore implements ConsentProjectionStore {
  constructor(private readonly deps: PrismaConsentProjectionDeps) {}

  /** ADR-0014: reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  private scoped<T>(
    tenantId: string,
    tx: unknown,
    run: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx !== undefined && tx !== null
      ? run(tx as TransactionClient)
      : runReadScoped(this.deps.prisma, tenantId, run);
  }

  async upsert(record: ConsentProjectionRecord, tenantId: string, tx?: unknown): Promise<void> {
    await this.scoped(tenantId, tx, async (client) => {
      const existing = await client.securityConsentProjection.findFirst({
        where: {
          tenantId,
          subjectRef: record.subjectRef,
          purpose: record.purpose,
        },
      });
      if (existing === null) {
        await client.securityConsentProjection.create({
          data: {
            id: this.deps.idGenerator.generate(),
            tenantId,
            subjectRef: record.subjectRef,
            purpose: record.purpose,
            granted: record.granted,
            occurredAt: record.occurredAt,
          },
        });
        return;
      }
      if (existing.occurredAt >= record.occurredAt) return; // LWW: keep the newer decision
      await client.securityConsentProjection.updateMany({
        where: {
          tenantId,
          subjectRef: record.subjectRef,
          purpose: record.purpose,
        },
        data: { granted: record.granted, occurredAt: record.occurredAt },
      });
    });
  }

  async get(
    subjectRef: string,
    purpose: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<ConsentProjectionRecord | null> {
    const row = await this.scoped(tenantId, tx, (c) =>
      c.securityConsentProjection.findFirst({
        where: { tenantId, subjectRef, purpose },
      }),
    );
    if (row === null) return null;
    return {
      subjectRef: row.subjectRef,
      purpose: row.purpose,
      granted: row.granted,
      occurredAt: row.occurredAt,
    };
  }
}
