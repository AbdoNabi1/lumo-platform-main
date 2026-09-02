import type { AuditEvent, Permission, Principal } from "@platform/contracts";
import type { SecurityPort } from "../application/ports";

/**
 * Real fail-closed in-memory `SecurityPort` — an inspectable audit trail, not a stub. Grants a
 * permission when the principal's `roles` includes it verbatim, or the `staff` role wildcard
 * `finance:*`; step-up is tracked per-principal via {@link markSteppedUp} (tests opt in
 * explicitly, so step-up defaults closed).
 */
export class InMemorySecurity implements SecurityPort {
  private readonly steppedUp = new Set<string>();
  private readonly auditLog: AuditEvent[] = [];

  async authorize(principal: Principal, permission: Permission): Promise<boolean> {
    return principal.roles.includes(permission) || principal.roles.includes("finance:*");
  }

  async hasSteppedUp(principalId: string): Promise<boolean> {
    return this.steppedUp.has(principalId);
  }

  async record(event: AuditEvent): Promise<void> {
    this.auditLog.push(event);
  }

  markSteppedUp(principalId: string): void {
    this.steppedUp.add(principalId);
  }

  get audit(): readonly AuditEvent[] {
    return this.auditLog;
  }
}
