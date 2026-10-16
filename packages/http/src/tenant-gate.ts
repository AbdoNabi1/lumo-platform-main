import type { RouteDefinition } from "./route";

/**
 * T10.6 (Gap 1): the tenant's lifecycle status, enforced ONCE in the request pipeline right after the
 * tenant is resolved and before authorization (`executeRoute`). A feature cannot forget it because no
 * feature is asked: an endpoint added tomorrow is gated the day it is registered.
 *
 * `unknown` means the tenant has no row. A status that cannot be READ at all is not a value: the port
 * throws, and the pipeline answers 503 (fail closed — a tenant whose status is unknown is not served).
 */
export type TenantAvailability = "active" | "suspended" | "cancelled" | "unknown";

export interface TenantGate {
  availability(tenantId: string): Promise<TenantAvailability>;
}

/**
 * What a SUSPENDED tenant may still do — the allowed set is this function, not an accident of routing:
 *
 *  - an authenticated, non-public `GET`: the merchant can still read (and export) their own data;
 *  - a route that opts in with `allowWhenSuspended: true`: today that is paying an overdue invoice —
 *    refusing it would make suspension for non-payment impossible to cure.
 *
 * Everything else is refused: any write, and all public storefront traffic (a suspended store takes no
 * orders and shows no catalog). A CANCELLED tenant is refused everything; this policy is not consulted.
 */
export function suspendedTenantMayCall(route: RouteDefinition): boolean {
  if (route.allowWhenSuspended === true) return true;
  return route.method === "GET" && route.public !== true;
}
