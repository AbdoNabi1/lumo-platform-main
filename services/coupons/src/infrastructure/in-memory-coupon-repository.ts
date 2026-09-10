import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Coupon } from "../domain/coupon";
import type { CouponRepository } from "../domain/coupon-repository";

export interface InMemoryCouponRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `CouponRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryCouponRepository implements CouponRepository {
  private readonly store = new Map<string, Coupon>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryCouponRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(coupon: Coupon, tx?: unknown): Promise<void> {
    this.store.set(coupon.id.toString(), coupon);
    await this.outbox.write(coupon.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<Coupon | null> {
    return this.store.get(id) ?? null;
  }

  async findByCode(code: string, _tenantId: string): Promise<Coupon | null> {
    for (const coupon of this.store.values()) {
      if (coupon.code.value === code) return coupon;
    }
    return null;
  }

  async hasRedemption(
    couponId: string,
    idempotencyKey: string,
    _tenantId: string,
  ): Promise<boolean> {
    const coupon = this.store.get(couponId);
    if (coupon === undefined) return false;
    return coupon.redemptions.some((r) => r.idempotencyKey === idempotencyKey);
  }

  async list(page: CursorPage, _tenantId: string): Promise<Paginated<Coupon>> {
    const limit = normalizePageSize(page.first);
    const all = [...this.store.values()].sort((a, b) =>
      a.id.toString() < b.id.toString() ? 1 : -1,
    );
    const after = page.after;
    const startIndex =
      after === undefined ? 0 : all.findIndex((coupon) => coupon.id.toString() === after) + 1;
    const rows = all.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(rows, limit, (coupon) => coupon.id.toString());
  }
}
