import type { CheckoutSession } from "./checkout-session";

/** Persistence port for {@link CheckoutSession}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface CheckoutSessionRepository {
  save(session: CheckoutSession, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<CheckoutSession | null>;
}
