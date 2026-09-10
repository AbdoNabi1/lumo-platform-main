import type { CursorPage, Paginated } from "@platform/types";
import type { Coupon } from "./coupon";

/**
 * Persistence port for {@link Coupon}. Implemented in infrastructure. The optional `tx` scopes the
 * call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): `findById`/`findByCode`/`hasRedemption`/`list` take `tenantId` as an
 * explicit per-call parameter, matching `services/catalog`'s first-converted-context shape. `save`
 * is not yet converted.
 */
export interface CouponRepository {
  save(coupon: Coupon, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Coupon | null>;
  /** Looks up a coupon by its normalized code — the primary redemption-time lookup. */
  findByCode(code: string, tenantId: string, tx?: unknown): Promise<Coupon | null>;
  /** Whether a redemption with this idempotency key has already been recorded for this coupon. */
  hasRedemption(
    couponId: string,
    idempotencyKey: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean>;
  /** Cursor page, most recently created first (Phase A.30 admin Discounts screen). */
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Coupon>>;
}
