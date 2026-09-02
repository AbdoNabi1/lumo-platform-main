import type { OrderCreationPort } from "../application/ports";

/**
 * Offline in-memory stub for `OrderCreationPort` (C-2). Same `deps.orderCreation ??
 * new InMemoryOrderCreationAdapter()` convention as the 5 orchestration adapters in
 * `in-memory-orchestration-adapters.ts`. Fabricates a deterministic `orderRef` from the session id
 * and never persists anything, so it must never back a real checkout.
 *
 * Reachability, stated precisely (the earlier version of this comment was stale): `wireAdmin`
 * UNCONDITIONALLY overrides this stub with the real `OrderCreationAdapter` over Orders'
 * `CreateOrderFromCheckout` (`apps/admin/src/composition.ts`, Task 17a), so no `wireAdmin`-composed
 * process can resolve to it. The only remaining path here is a direct `wireCheckout()` caller that
 * bypasses `wireAdmin` entirely — tests, mostly. `apps/runtime/src/api.ts`'s
 * `assertProductionIntegrationPortsConfigured` no longer lists `orderCreation` (removed in commit
 * `3a196bd`, once the real adapter became the unconditional default: re-listing it would re-stub a
 * port that already has a real adapter and defeat the guard), and nothing else guards the direct
 * `wireCheckout()` path specifically. That is deliberate, not an oversight — `wireCheckout()` on
 * its own was never a production entry point.
 */
export class InMemoryOrderCreationAdapter implements OrderCreationPort {
  async create(input: {
    readonly checkoutSessionId: string;
  }): Promise<{ readonly orderRef: string }> {
    return { orderRef: `order-${input.checkoutSessionId}` };
  }
}
