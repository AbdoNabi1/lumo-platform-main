import type { CursorPage, Paginated } from "@platform/types";
import type { Coupon } from "./coupon";

/** Persistence port for {@link Coupon}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface CouponRepository {
  save(coupon: Coupon, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Coupon | null>;
  /** Looks up a coupon by its normalized code — the primary redemption-time lookup. */
  findByCode(code: string, tx?: unknown): Promise<Coupon | null>;
  /** Whether a redemption with this idempotency key has already been recorded for this coupon. */
  hasRedemption(couponId: string, idempotencyKey: string, tx?: unknown): Promise<boolean>;
  /** Cursor page, most recently created first (Phase A.30 admin Discounts screen). */
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Coupon>>;
}
