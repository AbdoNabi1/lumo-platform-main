import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { SecurityChanged } from "../domain/events/security-changed.event";

/** Maps Security domain events to integration events (carries the canonical `event` name + aggregate). */
export class SecurityEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof SecurityChanged) {
      return {
        type: event.data.event,
        eventVersion: 1,
        aggregateType: event.data.aggregate,
        payload: event.data,
      };
    }
    return undefined;
  }
}

/**
 * The canonical integration events Security publishes (runtime-verified by `securityModule`,
 * FF-ARCH-07). Every type is a 3-segment `security.<aggregate>.<event>`, PII-free and tenant-aware.
 * Human identity/consent events stay in the Identity context (frozen ownership).
 */
export const SECURITY_PUBLISHED_EVENTS = [
  "security.principal.registered",
  "security.principal.suspended",
  "security.principal.activated",
  "security.principal.disabled",
  "security.credential.issued",
  "security.credential.rotated",
  "security.credential.revoked",
  "security.credential.expired",
  "security.session.established",
  "security.session.refreshed",
  "security.session.revoked",
  "security.session.revoked_all",
  "security.session.expired",
  "security.role.defined",
  "security.role.assigned",
  "security.role.revoked",
  "security.policy.defined",
  "security.policy.version_published",
  "security.policy.archived",
  "security.delegation.granted",
  "security.delegation.revoked",
  "security.tenant_profile.configured",
  "security.access.evaluated",
  "security.audit.recorded",
  // P2.0-B — authentication, MFA, device identity, risk
  "security.device.registered",
  "security.device.trusted",
  "security.device.blocked",
  "security.auth_method.registered",
  "security.auth.succeeded",
  "security.auth.failed",
  "security.mfa.enrolled",
  "security.mfa.challenged",
  "security.mfa.verified",
  "security.mfa.revoked",
  "security.risk.evaluated",
  // P2.0-C — secret rotation, machine identity governance, ReBAC
  "security.credential.rotation_scheduled",
  "security.machine_identity.governed",
  "security.machine_identity.suspended",
  "security.relation.written",
  "security.relation.deleted",
  // P2.0-D — security registry, compliance
  "security.registry.updated",
  "security.compliance.evaluated",
  // P2.0-E — incidents, threat intelligence
  "security.incident.opened",
  "security.incident.triaged",
  "security.incident.mitigated",
  "security.incident.resolved",
  "security.incident.closed",
  "security.incident.evidence_added",
  "security.threat.detected",
  // P2.0-F — AI security governance
  "security.ai_identity.governed",
  "security.ai_identity.suspended",
  "security.ai_identity.budget_exceeded",
] as const;
