import type { AccessControl, AuditTrail, Clock, Permission, Principal } from "@platform/contracts";
import { AuthorizationError, toErrorEnvelope } from "@platform/utils";
import type { AdminResponse } from "./admin-response";

export interface AdminGuardDeps {
  readonly accessControl: AccessControl;
  readonly auditTrail: AuditTrail;
  readonly clock: Clock;
}

/**
 * The admin boundary's policy-enforcement point (ADR-0007/0009): authorizes the acting principal
 * and records the decision on the immutable audit trail in one seam. `ensure` resolves to `null`
 * when the action may proceed, otherwise a transport-neutral 403 with the uniform error envelope —
 * the only response shape the admin layer owns (success and domain errors stay delegated to the
 * owning context's presenter). Every decision — allow and deny — is audited; an audit-write
 * failure fails the action.
 */
export class AdminGuard {
  private readonly deps: AdminGuardDeps;

  constructor(deps: AdminGuardDeps) {
    this.deps = deps;
  }

  async ensure(principal: Principal, permission: Permission): Promise<AdminResponse | null> {
    const allowed = await this.deps.accessControl.authorize(principal, permission);
    await this.deps.auditTrail.record({
      principalId: principal.id,
      principalKind: principal.kind,
      permission,
      decision: allowed ? "allow" : "deny",
      occurredAt: this.deps.clock.now().toISOString(),
    });
    if (allowed) {
      return null;
    }
    return {
      status: 403,
      body: toErrorEnvelope(new AuthorizationError(`Missing permission "${permission}"`)),
    };
  }
}
