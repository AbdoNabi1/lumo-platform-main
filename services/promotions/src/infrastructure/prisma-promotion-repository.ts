import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Promotion } from "../domain/promotion";
import type { PromotionRepository } from "../domain/promotion-repository";
import { PromotionMapper, type PromotionRow } from "./promotion.mapper";

export interface PrismaPromotionRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/** Production `PromotionRepository` on the `promotions` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaPromotionRepository implements PromotionRepository {
  private readonly deps: PrismaPromotionRepositoryDeps;

  constructor(deps: PrismaPromotionRepositoryDeps) {
    this.deps = deps;
  }

  async save(promotion: Promotion, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const promotionId = promotion.id.toString();
    const row = PromotionMapper.toRow(promotion, tenantId);

    if (promotion.version === 0) {
      await client.promotion.create({
        data: {
          ...row,
          reward: row.reward,
          targetRefs: row.targetRefs,
        },
      });
    } else {
      const updated = await client.promotion.updateMany({
        where: { id: promotionId, tenantId, version: promotion.version },
        data: {
          usageCount: row.usageCount,
          status: row.status,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Promotion ${promotionId} was modified concurrently (expected version ${promotion.version})`,
        );
      }
    }

    await this.deps.outbox.write(promotion.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Promotion | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.promotion.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    if (row === null) return null;
    return PromotionMapper.toDomain(this.toMapperRow(row));
  }

  async findActive(tx?: unknown): Promise<readonly Promotion[]> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const rows = await client.promotion.findMany({
      where: { tenantId: this.deps.tenantId, status: "active" },
    });
    return rows.map((row) => PromotionMapper.toDomain(this.toMapperRow(row)));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Promotion>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.promotion.findMany({
      where: {
        tenantId: this.deps.tenantId,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => PromotionMapper.toDomain(this.toMapperRow(row))),
      limit,
      (p) => p.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly name: string;
    readonly ruleType: string;
    readonly scope: string;
    readonly targetRefs: unknown;
    readonly minimumQuantity: number | null;
    readonly minimumSubtotalAmountMinor: number | null;
    readonly reward: unknown;
    readonly stackable: boolean;
    readonly priority: number;
    readonly startsAt: Date;
    readonly endsAt: Date | null;
    readonly customerRefs: unknown;
    readonly segmentRefs: unknown;
    readonly campaignRef: string | null;
    readonly usageLimit: number | null;
    readonly usageCount: number;
    readonly status: string;
    readonly version: number;
  }): PromotionRow {
    const reward = row.reward as {
      type: string;
      buyQuantity?: number;
      getQuantity?: number;
      value?: number;
    };
    return {
      id: row.id,
      name: row.name,
      ruleType: row.ruleType as PromotionRow["ruleType"],
      scope: row.scope as PromotionRow["scope"],
      targetRefs: row.targetRefs as readonly string[],
      minimumQuantity: row.minimumQuantity ?? undefined,
      minimumSubtotalAmountMinor: row.minimumSubtotalAmountMinor ?? undefined,
      rewardType: reward.type as PromotionRow["rewardType"],
      rewardValue: reward.value,
      buyQuantity: reward.buyQuantity,
      getQuantity: reward.getQuantity,
      stackable: row.stackable,
      priority: row.priority,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      customerRefs: row.customerRefs as readonly string[] | null,
      segmentRefs: row.segmentRefs as readonly string[] | null,
      campaignRef: row.campaignRef,
      usageLimit: row.usageLimit,
      usageCount: row.usageCount,
      status: row.status,
      version: row.version,
    };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaPromotionRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
