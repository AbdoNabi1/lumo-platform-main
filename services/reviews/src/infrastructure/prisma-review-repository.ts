import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Review } from "../domain/review";
import type { ReviewListFilter, ReviewRepository } from "../domain/review-repository";
import { ReviewMapper, type ReviewRow } from "./review.mapper";

export interface PrismaReviewRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/** Production `ReviewRepository` on the `reviews` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaReviewRepository implements ReviewRepository {
  private readonly deps: PrismaReviewRepositoryDeps;

  constructor(deps: PrismaReviewRepositoryDeps) {
    this.deps = deps;
  }

  async save(review: Review, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const reviewId = review.id.toString();
    const row = ReviewMapper.toRow(review, tenantId);

    if (review.version === 0) {
      await client.review.create({
        data: {
          ...row,
          assetRefs: row.assetRefs,
          votes: row.votes,
          moderations: row.moderations,
        },
      });
    } else {
      const updated = await client.review.updateMany({
        where: { id: reviewId, tenantId, version: review.version },
        data: {
          status: row.status,
          votes: row.votes,
          moderations: row.moderations,
          reportCount: row.reportCount,
          merchantResponse: row.merchantResponse,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Review ${reviewId} was modified concurrently (expected version ${review.version})`,
        );
      }
    }

    await this.deps.outbox.write(review.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Review | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.review.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    if (row === null) return null;
    return ReviewMapper.toDomain(this.toMapperRow(row));
  }

  async findByCustomerAndProduct(
    customerRef: string,
    productRef: string,
    tx?: unknown,
  ): Promise<Review | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.review.findFirst({
      where: { customerRef, productRef, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return ReviewMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, filter?: ReviewListFilter, tx?: unknown): Promise<Paginated<Review>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.review.findMany({
      where: {
        tenantId: this.deps.tenantId,
        ...(filter?.status !== undefined ? { status: filter.status } : {}),
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => ReviewMapper.toDomain(this.toMapperRow(row))),
      limit,
      (r) => r.id.toString(),
    );
  }

  async findByProductRef(
    productRef: string,
    page: CursorPage,
    tx?: unknown,
  ): Promise<Paginated<Review>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.review.findMany({
      where: {
        tenantId: this.deps.tenantId,
        productRef,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => ReviewMapper.toDomain(this.toMapperRow(row))),
      limit,
      (r) => r.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly productRef: string;
    readonly customerRef: string;
    readonly rating: number;
    readonly bodyText: string;
    readonly assetRefs: unknown;
    readonly verifiedPurchase: boolean;
    readonly status: string;
    readonly votes: unknown;
    readonly moderations: unknown;
    readonly reportCount: number;
    readonly merchantResponse: string | null;
    readonly version: number;
  }): ReviewRow {
    return {
      ...row,
      assetRefs: row.assetRefs as ReviewRow["assetRefs"],
      votes: row.votes as ReviewRow["votes"],
      moderations: row.moderations as ReviewRow["moderations"],
    };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaReviewRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
