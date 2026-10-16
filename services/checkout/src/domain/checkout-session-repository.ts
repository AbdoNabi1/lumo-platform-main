import type { CheckoutSession } from "./checkout-session";

/** Persistence port for {@link CheckoutSession}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface CheckoutSessionRepository {
  save(session: CheckoutSession, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<CheckoutSession | null>;
}
