import { DomainEvent, type DomainEventProps } from "@platform/domain";

/**
 * The canonical integration-event names the Security context publishes — each a 3-segment
 * `security.<aggregate>.<event>` (FF-ARCH-07). PII-free and tenant-aware. Human identity/consent
 * events stay in the Identity context (frozen ownership) — Security never emits them.
 */
export type SecurityEventName =
  | "security.principal.registered"
  | "security.principal.suspended"
  | "security.principal.activated"
  | "security.principal.disabled"
  | "security.credential.issued"
  | "security.credential.rotated"
  | "security.credential.revoked"
  | "security.credential.expired"
  | "security.session.established"
  | "security.session.refreshed"
  | "security.session.revoked"
  | "security.session.revoked_all"
  | "security.session.expired"
  | "security.role.defined"
  | "security.role.assigned"
  | "security.role.revoked"
  | "security.policy.defined"
  | "security.policy.version_published"
  | "security.policy.archived"
  | "security.delegation.granted"
  | "security.delegation.revoked"
  | "security.tenant_profile.configured"
  | "security.access.evaluated"
  | "security.audit.recorded"
  // P2.0-B — authentication, MFA, device identity, risk
  | "security.device.registered"
  | "security.device.trusted"
  | "security.device.blocked"
  | "security.auth_method.registered"
  | "security.auth.succeeded"
  | "security.auth.failed"
  | "security.mfa.enrolled"
  | "security.mfa.challenged"
  | "security.mfa.verified"
  | "security.mfa.revoked"
  | "security.risk.evaluated"
  // P2.0-C — secret rotation, machine identity governance, ReBAC
  | "security.credential.rotation_scheduled"
  | "security.machine_identity.governed"
  | "security.machine_identity.suspended"
  | "security.relation.written"
  | "security.relation.deleted"
  // P2.0-D — security registry, compliance
  | "security.registry.updated"
  | "security.compliance.evaluated"
  // P2.0-E — incidents, threat intelligence
  | "security.incident.opened"
  | "security.incident.triaged"
  | "security.incident.mitigated"
  | "security.incident.resolved"
  | "security.incident.closed"
  | "security.incident.evidence_added"
  | "security.threat.detected"
  // P2.0-F — AI security governance
  | "security.ai_identity.governed"
  | "security.ai_identity.suspended"
  | "security.ai_identity.budget_exceeded";

/** The aggregate segment carried as the integration event's `aggregateType`. */
export type SecurityAggregate =
  | "principal"
  | "credential"
  | "session"
  | "role"
  | "policy"
  | "delegation"
  | "tenant_profile"
  | "access"
  | "audit"
  | "device"
  | "auth_method"
  | "auth"
  | "mfa"
  | "risk"
  | "machine_identity"
  | "relation"
  | "registry"
  | "compliance"
  | "incident"
  | "threat"
  | "ai_identity";

export interface SecurityChangedData {
  readonly aggregateId: string;
  readonly aggregate: SecurityAggregate;
  /** Business key for the aggregate (principal external id, role key, policy key, …). */
  readonly key: string;
  readonly event: SecurityEventName;
  /** Coarse status/outcome carried for read models (never a secret value or PII). */
  readonly status: string;
}

/**
 * Raised on every validated Security fact (identity/credential/session/role/policy/delegation/
 * tenant-profile lifecycle + zero-trust decisions + audit anchoring). The translator maps it to the
 * canonical `event` type it carries. PII-free, tenant-aware, outbox-delivered (ADR-0023, ADR-0006).
 */
export class SecurityChanged extends DomainEvent {
  readonly eventName = "security.changed";
  readonly data: SecurityChangedData;

  constructor(props: DomainEventProps, data: SecurityChangedData) {
    super(props);
    this.data = data;
  }
}
