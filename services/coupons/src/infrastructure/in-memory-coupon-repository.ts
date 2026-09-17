import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Coupon } from "../domain/coupon";
import type { CouponRepository } from "../domain/coupon-repository";

export interface InMemoryCouponRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `CouponRepository`. Persists the aggregate and writes events to the outbox on save.
 * ADR-0014 (WP-10, T10.3): keyed by `(tenantId, couponId)` — `Coupon` carries no `tenantId` of its
 * own, so the store must key on it explicitly or a cross-tenant leak here would be invisible to
 * every isolation test.
 */
export class InMemoryCouponRepository implements CouponRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly coupon: Coupon }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryCouponRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(coupon: Coupon, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(coupon.id.toString(), { tenantId, coupon });
    await this.outbox.write(coupon.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<Coupon | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.coupon : null;
  }

  async findByCode(code: string, tenantId: string): Promise<Coupon | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.coupon.code.value === code) return entry.coupon;
    }
    return null;
  }

  async hasRedemption(
    couponId: string,
    idempotencyKey: string,
    tenantId: string,
  ): Promise<boolean> {
    const entry = this.store.get(couponId);
    if (entry === undefined || entry.tenantId !== tenantId) return false;
    return entry.coupon.redemptions.some((r) => r.idempotencyKey === idempotencyKey);
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Coupon>> {
    const limit = normalizePageSize(page.first);
    const all = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.coupon)
      .sort((a, b) => (a.id.toString() < b.id.toString() ? 1 : -1));
    const after = page.after;
    const startIndex =
      after === undefined ? 0 : all.findIndex((coupon) => coupon.id.toString() === after) + 1;
    const rows = all.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(rows, limit, (coupon) => coupon.id.toString());
  }
}
