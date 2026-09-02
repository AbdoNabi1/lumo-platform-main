import type { AccessControl } from "@platform/contracts";

/**
 * Permissive `AccessControl` used until the real RBAC provider (Ory/Keto, Phase 2) is wired.
 * It exists so that every admin action already flows through the authorize seam today — swapping
 * in real RBAC is a composition-root change only; controller signatures and tests stay frozen
 * (docs/architecture/07, ADR-0007).
 */
export class AllowAllAccessControl implements AccessControl {
  authorize(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
