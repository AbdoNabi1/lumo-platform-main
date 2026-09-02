import type { Permission } from "./permission";
import type { PrincipalKind } from "./principal";

/**
 * A single tamper-evident audit record. Append-only by contract: implementations MUST never
 * update or delete entries (SOC2 CC7 / PCI DSS 10.x / doc 14 §6). `occurredAt` is supplied by
 * the caller (via the `Clock` port) so entries stay deterministic in tests.
 */
export interface AuditEvent {
  /** The acting principal's id. */
  readonly principalId: string;
  readonly principalKind: PrincipalKind;
  /** The permission that was checked, `"<module>:<action>"`. */
  readonly permission: Permission;
  /** The authorization outcome for this action. */
  readonly decision: "allow" | "deny";
  /** When the decision was made (RFC 3339 UTC). */
  readonly occurredAt: string;
  /** The tenant the action targeted, when known (ADR-0008). */
  readonly tenantId?: string;
  /** Small string→string bag for action-specific detail (aggregate id, reason, …). */
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Outbound port for the immutable audit trail (docs/architecture/14 §6, ADR-0009). Consumed by
 * policy-enforcement points (the admin guard today; transport middleware later). The production
 * adapter appends through the transactional outbox as `audit.entry.recorded` (doc 20 §14) into
 * 7-year archival storage; local/tests use an in-memory adapter. Failures to record MUST fail the
 * guarded action — an unauditable mutation is worse than a rejected one.
 */
export interface AuditTrail {
  record(event: AuditEvent): Promise<void>;
}
