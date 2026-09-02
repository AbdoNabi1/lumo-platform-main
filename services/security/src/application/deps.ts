import type { Clock, IdGenerator } from "@platform/contracts";
import type { DomainEvent } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { AuditChain } from "../domain/audit-chain";
import type { AuditRecord } from "../domain/audit-record";
import type { AuthorizationEvaluator } from "../domain/authorization";
import {
  SecurityChanged,
  type SecurityAggregate,
  type SecurityEventName,
} from "../domain/events/security-changed.event";
import type { RiskScorer, TrustScorer } from "../domain/risk";
import type {
  AiGovernanceProfileRepository,
  AuditLedgerRepository,
  CredentialRepository,
  DelegationRepository,
  DeviceRepository,
  IncidentRepository,
  MachineIdentityProfileRepository,
  MfaEnrollmentRepository,
  PolicyRepository,
  PrincipalRepository,
  RelationTupleRepository,
  RoleAssignmentRepository,
  RoleRepository,
  SessionRepository,
  TenantSecurityProfileRepository,
} from "../domain/repositories";
import { UniqueEntityId } from "@platform/domain";
import type { Registry } from "@platform/registry";
import type { AttributeEvaluator } from "../domain/abac";
import type { ComplianceControl, ComplianceEngine } from "../domain/compliance-engine";
import type { ThreatIntelAggregator } from "../domain/threat-intel";
import type { MfaEngine } from "../domain/mfa-engine";
import type { FragmentResolver, PolicyFragment } from "../domain/policy-expression";
import type { RiskEngine } from "../domain/risk-engine";
import type {
  AuthMethodSpec,
  MfaMethodSpec,
  PermissionDef,
} from "../domain/value-objects/auth-method";
import type { ZeroTrustEvaluator } from "../domain/zero-trust";
import type {
  AuthenticationProviderResolver,
  CryptoPort,
  GeoIpPort,
  MfaProviderResolver,
} from "./auth-ports";
import type { RelationshipCheckPort } from "./authz-ports";
import type { ComplianceRulePackResolver } from "./compliance-ports";
import type { ThreatIntelResolver } from "./threat-ports";
import type {
  ConsentPort,
  DeviceTrustPort,
  IdentityDirectoryPort,
  IdentityProjectionStore,
  KmsPort,
  SecurityTelemetryPort,
  SessionRevocationPort,
} from "./ports";

/**
 * Publishes Security integration events that do NOT originate from an aggregate `save` (zero-trust
 * decisions + WORM audit anchors). Aggregate lifecycle events flow through the repositories' outbox
 * on save; this port covers the two decision/audit facts so the `security.*` catalog is complete.
 */
export interface SecurityOutboxPort {
  publish(events: readonly DomainEvent[], tx?: unknown): Promise<void>;
}

/** The full dependency surface every Security use-case is constructed with (composition-injected). */
export interface SecurityDeps {
  readonly principals: PrincipalRepository;
  readonly credentials: CredentialRepository;
  readonly sessions: SessionRepository;
  readonly roles: RoleRepository;
  readonly assignments: RoleAssignmentRepository;
  readonly policies: PolicyRepository;
  readonly delegations: DelegationRepository;
  readonly tenantProfiles: TenantSecurityProfileRepository;
  readonly auditLedger: AuditLedgerRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly outbox: SecurityOutboxPort;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly kms: KmsPort;
  readonly identityDirectory: IdentityDirectoryPort;
  /** Consent read (H-2) — answers from the projection fed by Identity's consent events. */
  readonly consent: ConsentPort;
  /** Identity projection (H-2) — read model of Identity users/orgs/memberships for resolution. */
  readonly identityProjection: IdentityProjectionStore;
  /** Session enforcement sync (H-2) — propagates "revoke all" to Kratos (interface only in-context). */
  readonly sessionRevocation: SessionRevocationPort;
  readonly deviceTrust: DeviceTrustPort;
  readonly telemetry: SecurityTelemetryPort;
  readonly auditChain: AuditChain;
  readonly authorization: AuthorizationEvaluator;
  readonly zeroTrust: ZeroTrustEvaluator;
  readonly riskScorer: RiskScorer;
  readonly trustScorer: TrustScorer;
  // ── P2.0-B — authentication, MFA, device identity, risk, crypto ──
  readonly devices: DeviceRepository;
  readonly mfaEnrollments: MfaEnrollmentRepository;
  readonly crypto: CryptoPort;
  readonly geoIp: GeoIpPort;
  readonly authProviders: AuthenticationProviderResolver;
  readonly mfaProviders: MfaProviderResolver;
  readonly riskEngine: RiskEngine;
  readonly mfaEngine: MfaEngine;
  /** Versioned authentication-method registry (Registry Engine, `packages/registry`). */
  readonly authMethodRegistry: Registry<AuthMethodSpec>;
  // ── P2.0-C — machine identity governance + authorization evolution (ABAC/ReBAC) ──
  readonly machineProfiles: MachineIdentityProfileRepository;
  readonly relationTuples: RelationTupleRepository;
  readonly relationshipCheck: RelationshipCheckPort;
  readonly attributeEvaluator: AttributeEvaluator;
  // ── P2.0-D — composable policy language, security registry, compliance ──
  /** Versioned reusable policy fragments (Registry Engine) + the resolver the evaluator consumes. */
  readonly policyFragments: Registry<PolicyFragment>;
  readonly fragmentResolver: FragmentResolver;
  readonly mfaMethodRegistry: Registry<MfaMethodSpec>;
  readonly permissionRegistry: Registry<PermissionDef>;
  readonly complianceControlRegistry: Registry<ComplianceControl>;
  readonly complianceEngine: ComplianceEngine;
  readonly complianceRulePacks: ComplianceRulePackResolver;
  // ── P2.0-E — incidents, threat intelligence ──
  readonly incidents: IncidentRepository;
  readonly threatIntel: ThreatIntelResolver;
  readonly threatAggregator: ThreatIntelAggregator;
  // ── P2.0-F — AI security governance ──
  readonly aiProfiles: AiGovernanceProfileRepository;
}

export interface AuditAppendInput {
  readonly principalRef: string;
  readonly action: string;
  readonly decision: string;
  readonly resource?: string | null;
  readonly tenantRef?: string | null;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Appends a WORM audit record (hash-chained to the ledger tail), publishes `security.audit.recorded`
 * and bumps telemetry — the single audit seam every use-case funnels through (ADR-0009/ADR-0023).
 */
export async function recordAudit(
  deps: SecurityDeps,
  tx: unknown,
  input: AuditAppendInput,
): Promise<AuditRecord> {
  const tenantRef = input.tenantRef ?? null;
  const tail = await deps.auditLedger.tail(tenantRef, tx);
  const record = deps.auditChain.append(tail, {
    id: deps.idGenerator.generate(),
    principalRef: input.principalRef,
    action: input.action,
    decision: input.decision,
    resource: input.resource ?? null,
    tenantRef,
    occurredAt: deps.clock.now().toISOString(),
    metadata: input.metadata,
  });
  await deps.auditLedger.append(record, tx);
  deps.telemetry.increment("security.audit.recorded");
  await deps.outbox.publish(
    [
      securityEvent(
        deps,
        "audit",
        record.id,
        input.principalRef,
        "security.audit.recorded",
        input.decision,
      ),
    ],
    tx,
  );
  return record;
}

/** Builds a {@link SecurityChanged} for a non-aggregate fact (audit anchor / access decision). */
export function securityEvent(
  deps: SecurityDeps,
  aggregate: SecurityAggregate,
  aggregateId: string,
  key: string,
  event: SecurityEventName,
  status: string,
): SecurityChanged {
  return new SecurityChanged(
    {
      eventId: deps.idGenerator.generate(),
      aggregateId: UniqueEntityId.from(aggregateId),
      occurredAt: deps.clock.now(),
    },
    { aggregateId, aggregate, key, event, status },
  );
}
