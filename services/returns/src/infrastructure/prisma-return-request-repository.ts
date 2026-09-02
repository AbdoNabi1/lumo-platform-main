import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { ReturnRequest } from "../domain/return-request";
import type { ReturnRequestRepository } from "../domain/return-request-repository";
import { ReturnRequestMapper } from "./return-request.mapper";

export interface PrismaReturnRequestRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/**
 * Production `ReturnRequestRepository` on the `returns` schema. Attempts are append-only
 * (`skipDuplicates`, PK = entity id — the observability trail is never rewritten). Optimistic
 * locking + same-transaction outbox per ADR-0003. No card/rate/PII data (G-27).
 */
export class PrismaReturnRequestRepository implements ReturnRequestRepository {
  private readonly deps: PrismaReturnRequestRepositoryDeps;

  constructor(deps: PrismaReturnRequestRepositoryDeps) {
    this.deps = deps;
  }

  async save(returnRequest: ReturnRequest, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const returnId = returnRequest.id.toString();
    const row = ReturnRequestMapper.toRow(returnRequest, tenantId);

    if (returnRequest.version === 0) {
      await client.returnRequest.create({
        data: {
          ...row,
          items: row.items,
          approval: row.approval,
          inspections: row.inspections,
          refundDecision: row.refundDecision,
        },
      });
    } else {
      const updated = await client.returnRequest.updateMany({
        where: { id: returnId, tenantId, version: returnRequest.version },
        data: {
          status: row.status,
          approval: row.approval,
          rmaNumber: row.rmaNumber,
          inspections: row.inspections,
          refundDecision: row.refundDecision,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `ReturnRequest ${returnId} was modified concurrently (expected version ${returnRequest.version})`,
        );
      }
    }

    const attempts = ReturnRequestMapper.toAttemptRows(returnRequest, tenantId);
    if (attempts.length > 0) {
      await client.returnAttempt.createMany({ data: attempts, skipDuplicates: true });
    }

    await this.deps.outbox.write(returnRequest.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<ReturnRequest | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.returnRequest.findFirst({
      where: { id, tenantId: this.deps.tenantId },
      include: { attempts: { orderBy: { occurredAt: "asc" } } },
    });
    if (row === null) return null;
    return ReturnRequestMapper.toDomain(
      {
        ...row,
        // `items`/`inspections` are arrays of closed object shapes without index signatures, so they
        // don't structurally overlap with the Prisma `JsonValue` union (comparability fails).
        items: row.items as unknown as ReturnRequestRow["items"],
        approval: row.approval as ReturnRequestRow["approval"],
        inspections: row.inspections as unknown as ReturnRequestRow["inspections"],
        refundDecision: row.refundDecision as ReturnRequestRow["refundDecision"],
      },
      row.attempts,
    );
  }

  async findByOrderRef(orderRef: string, tx?: unknown): Promise<ReturnRequest | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.returnRequest.findFirst({
      where: { orderRef, tenantId: this.deps.tenantId },
      include: { attempts: { orderBy: { occurredAt: "asc" } } },
    });
    if (row === null) return null;
    return ReturnRequestMapper.toDomain(
      {
        ...row,
        items: row.items as unknown as ReturnRequestRow["items"],
        approval: row.approval as ReturnRequestRow["approval"],
        inspections: row.inspections as unknown as ReturnRequestRow["inspections"],
        refundDecision: row.refundDecision as ReturnRequestRow["refundDecision"],
      },
      row.attempts,
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaReturnRequestRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}

type ReturnRequestRow = Parameters<typeof ReturnRequestMapper.toDomain>[0];
