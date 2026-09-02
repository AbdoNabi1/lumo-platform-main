import type { Permission } from "./permission";
import type { Principal } from "./principal";

/**
 * Decides whether a principal may perform an action (RBAC for Phase 1). Implemented by the
 * application/infrastructure wiring and consumed by application use-cases guarding staff actions.
 * Callers map a `false` result to an `AuthorizationError` (`@platform/utils`).
 */
export interface AccessControl {
  authorize(principal: Principal, permission: Permission): Promise<boolean>;
}
