import { Prisma } from "@prisma/client";
import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Promotion } from "../domain/promotion";
import type { AdminPromotionQuery, PromotionRepository } from "../domain/promotion-repository";
import { PromotionMapper, promotionRowFromRecord } from "./promotion.mapper";

export interface PrismaPromotionRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/** Prisma requires an explicit SQL-NULL sentinel for nullable `Json?` columns — bare `null` is ambiguous. */
function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : value;
}

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

/** Production `PromotionRepository` on the `promotions` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaPromotionRepository implements PromotionRepository {
  private readonly deps: PrismaPromotionRepositoryDeps;

  constructor(deps: PrismaPromotionRepositoryDeps) {
    this.deps = deps;
  }

  async save(promotion: Promotion, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const promotionId = promotion.id.toString();
    const row = PromotionMapper.toRow(promotion, tenantId);

    const data = {
      name: row.name,
      ruleType: row.ruleType,
      scope: row.scope,
      targetRefs: row.targetRefs,
      minimumQuantity: row.minimumQuantity,
      minimumSubtotalAmountMinor: row.minimumSubtotalAmountMinor,
      reward: row.reward as Prisma.InputJsonValue,
      stackable: row.stackable,
      priority: row.priority,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      customerRefs: jsonOrDbNull(row.customerRefs),
      segmentRefs: jsonOrDbNull(row.segmentRefs),
      campaignRef: row.campaignRef,
      usageLimit: row.usageLimit,
      usageCount: row.usageCount,
      status: row.status,
      method: row.method,
      discountClass: row.discountClass,
      combinesWith: row.combinesWith as Prisma.InputJsonValue,
    };
    if (promotion.version === 0) {
      await client.promotion.create({ data: { id: row.id, tenantId, ...data } });
    } else {
      const updated = await client.promotion.updateMany({
        where: { id: promotionId, tenantId, version: promotion.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Promotion ${promotionId} was modified concurrently (expected version ${promotion.version})`,
        );
      }
    }

    await this.deps.outbox.write(
      promotion.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<Promotion | null> {
    const row = await readScoped(this.deps.prisma, tenantId, tx, (client) =>
      client.promotion.findFirst({ where: { id, tenantId } }),
    );
    if (row === null) return null;
    return PromotionMapper.toDomain(promotionRowFromRecord(row));
  }

  async findActive(tenantId: string, tx?: unknown): Promise<readonly Promotion[]> {
    const rows = await readScoped(this.deps.prisma, tenantId, tx, (client) =>
      client.promotion.findMany({
        where: { tenantId, status: "active" },
      }),
    );
    return rows.map((row) => PromotionMapper.toDomain(promotionRowFromRecord(row)));
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Promotion>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await readScoped(this.deps.prisma, tenantId, tx, (client) =>
      client.promotion.findMany({
        where: {
          tenantId,
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: "asc" },
        take: limit + 1,
      }),
    );
    return buildPaginatedPage(
      rows.map((row) => PromotionMapper.toDomain(promotionRowFromRecord(row))),
      limit,
      (p) => p.id.toString(),
    );
  }

  async findActiveAutomatic(tenantId: string, tx?: unknown): Promise<readonly Promotion[]> {
    const rows = await readScoped(this.deps.prisma, tenantId, tx, (client) =>
      client.promotion.findMany({ where: { tenantId, status: "active", method: "automatic" } }),
    );
    return rows.map((row) => PromotionMapper.toDomain(promotionRowFromRecord(row)));
  }

  async listForAdmin(
    query: AdminPromotionQuery,
    tenantId: string,
    tx?: unknown,
  ): Promise<Paginated<Promotion>> {
    const after = query.after !== undefined ? decodeCursor(query.after) : undefined;
    const limit = normalizePageSize(query.first);
    const now = query.now;
    const view: Prisma.PromotionWhereInput =
      query.view === "active"
        ? {
            status: "active",
            startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          }
        : query.view === "scheduled"
          ? { status: { in: ["active", "scheduled"] }, startsAt: { gt: now } }
          : query.view === "expired"
            ? {
                OR: [
                  { status: { in: ["draft", "paused", "expired", "depleted", "cancelled"] } },
                  { endsAt: { lte: now } },
                ],
              }
            : {};
    const search = query.search?.trim();
    const where: Prisma.PromotionWhereInput = {
      AND: [
        { tenantId, status: { not: "archived" } },
        view,
        ...(search === undefined || search === ""
          ? []
          : [
              {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { id: { in: [...(query.alsoIds ?? [])] } },
                ],
              },
            ]),
        ...(after === undefined ? [] : [{ id: { lt: after } }]),
      ],
    };
    const rows = await readScoped(this.deps.prisma, tenantId, tx, (client) =>
      client.promotion.findMany({ where, orderBy: { id: "desc" }, take: limit + 1 }),
    );
    return buildPaginatedPage(
      rows.map((row) => PromotionMapper.toDomain(promotionRowFromRecord(row))),
      limit,
      (p) => p.id.toString(),
    );
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
