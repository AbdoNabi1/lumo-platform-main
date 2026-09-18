import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Coupon } from "../domain/coupon";
import type { CouponRepository } from "../domain/coupon-repository";
import { CouponMapper, type CouponRow } from "./coupon.mapper";

export interface PrismaCouponRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/** Production `CouponRepository` on the `coupons` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaCouponRepository implements CouponRepository {
  private readonly deps: PrismaCouponRepositoryDeps;

  constructor(deps: PrismaCouponRepositoryDeps) {
    this.deps = deps;
  }

  async save(coupon: Coupon, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const couponId = coupon.id.toString();
    const row = CouponMapper.toRow(coupon, tenantId);

    if (coupon.version === 0) {
      await client.coupon.create({
        data: { ...row, redemptions: row.redemptions },
      });
    } else {
      const updated = await client.coupon.updateMany({
        where: { id: couponId, tenantId, version: coupon.version },
        data: {
          usageCount: row.usageCount,
          status: row.status,
          redemptions: row.redemptions,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Coupon ${couponId} was modified concurrently (expected version ${coupon.version})`,
        );
      }
    }

    await this.deps.outbox.write(
      coupon.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Coupon | null> {
    const run = (client: TransactionClient) => client.coupon.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : CouponMapper.toDomain(this.toMapperRow(row));
  }

  async findByCode(code: string, tenantId: string, tx?: unknown): Promise<Coupon | null> {
    const run = (client: TransactionClient) =>
      client.coupon.findFirst({ where: { code, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : CouponMapper.toDomain(this.toMapperRow(row));
  }

  async hasRedemption(
    couponId: string,
    idempotencyKey: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean> {
    const run = (client: TransactionClient) =>
      client.coupon.findFirst({
        where: { id: couponId, tenantId },
        select: { redemptions: true },
      });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    if (row === null) return false;
    // Prisma's `JsonValue` union has no structural overlap with a concrete element shape
    // (comparability fails, not just assignability).
    const redemptions = row.redemptions as unknown as ReadonlyArray<{ idempotencyKey: string }>;
    return redemptions.some((r) => r.idempotencyKey === idempotencyKey);
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Coupon>> {
    const limit = normalizePageSize(page.first);
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const run = (client: TransactionClient) =>
      client.coupon.findMany({
        where: { tenantId, ...(after !== undefined ? { id: { lt: after } } : {}) },
        orderBy: { id: "desc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    const coupons = rows.map((row) => CouponMapper.toDomain(this.toMapperRow(row)));
    return buildPaginatedPage(coupons, limit, (coupon) => coupon.id.toString());
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly code: string;
    readonly promotionRef: string;
    readonly multiUse: boolean;
    readonly customerRef: string | null;
    readonly campaignRef: string | null;
    readonly usageLimit: number | null;
    readonly usageCount: number;
    readonly expiresAt: Date | null;
    readonly status: string;
    readonly redemptions: unknown;
    readonly version: number;
  }): CouponRow {
    return { ...row, redemptions: row.redemptions as CouponRow["redemptions"] };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaCouponRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
