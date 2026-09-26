// Composition root
export { wireSecurity } from "./composition";
export type { SecurityWiringDeps, WiredSecurity } from "./composition";

// Interface boundary + read models + SDK
export { SecurityController } from "./interfaces/security.controller";
export type { SecurityControllerDeps } from "./interfaces/security.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { SecurityConsoleReadModels } from "./interfaces/read-models";
export {
  BASELINE_POLICY_KEY,
  OWNER_GRANT,
  PLATFORM_ADMIN_ROLE,
  PLATFORM_SERVICE_ROLE,
  SYSTEM_GRANTOR,
  bootstrapSecurity,
} from "./interfaces/tenant-baseline";
export type { SecurityBootstrapSummary } from "./interfaces/tenant-baseline";
export type {
  AuditExplorer,
  DeviceExplorer,
  IdentityOverview,
  MachineIdentityExplorer,
  PermissionExplorer,
  SecurityDashboard,
  TenantBaselineState,
} from "./interfaces/read-models";
export { SecuritySdk } from "./interfaces/security-sdk";
export type {
  SecuritySdkDeps,
  DecisionExplanation,
  FederatedSessionOutcome,
} from "./interfaces/security-sdk";
// External session federation (ADR-0031) — the edge binds an IdP `sid` to a Security session.
export type { FederateExternalSessionInput } from "./application/session.use-cases";
// T5.17 — customer-facing session validation: the flat, aggregate-free identity behind a session.
export type {
  IntrospectSessionSubjectInput,
  SessionSubject,
} from "./application/session.use-cases";
// Zero-trust access decision types — reused by the H-4 edge guard (decision stays in EvaluateAccess).
export type { EvaluateAccessInput, AccessDecisionOutput } from "./application/access.use-cases";

// Application ports (interfaces only — providers wired later)
export type {
  ConsentPort,
  ConsentProjectionRecord,
  ConsentProjectionStore,
  DeviceTrustPort,
  HsmPort,
  HsmProviderPort,
  HsmKeyAlgorithm,
  HsmKeyRef,
  IdentityDirectoryPort,
  IdentityMembershipRecord,
  IdentityOrganizationRecord,
  IdentityProjectionStore,
  IdentityUserRecord,
  KmsPort,
  SecurityMetric,
  SecurityTelemetryPort,
  SessionRevocationPort,
  ThreatIntelFeedPort,
} from "./application/ports";

// ── H-2 (G-SEC-4) live identity binding — consent projection + sync consumers (ports; Ory adapters
// live in the composition/runtime layer so the context stays Ory-agnostic, per the frozen design). ──
export {
  InMemoryConsentProjectionStore,
  ProjectionConsentPort,
} from "./infrastructure/consent-projection";
export { PrismaConsentProjectionStore } from "./infrastructure/prisma-consent-projection";
export type { PrismaConsentProjectionDeps } from "./infrastructure/prisma-consent-projection";
export { InMemoryIdentityProjectionStore } from "./infrastructure/identity-projection";
export { PrismaIdentityProjectionStore } from "./infrastructure/prisma-identity-projection";
export type { PrismaIdentityProjectionDeps } from "./infrastructure/prisma-identity-projection";
export {
  ResolvePrincipal,
  ResolveMembership,
  ResolveOrganization,
  ResolveMachineIdentity,
} from "./application/resolution.use-cases";
export type {
  ResolvePrincipalInput,
  ResolvedPrincipal,
  ResolvedMembership,
  ResolveMembershipInput,
  MembershipResolution,
  ResolveOrganizationInput,
  OrganizationResolution,
  ResolveMachineIdentityInput,
  MachineIdentityResolution,
} from "./application/resolution.use-cases";
export {
  IdentityUserCreatedConsumer,
  IdentityUserDeactivatedConsumer,
  IdentityOrganizationCreatedConsumer,
  IdentityMembershipCreatedConsumer,
  IdentityMembershipRoleChangedConsumer,
} from "./interfaces/identity-projection.consumers";
export type {
  IdentityUserCreatedPayload,
  IdentityUserDeactivatedPayload,
  IdentityOrganizationCreatedPayload,
  IdentityMembershipCreatedPayload,
  IdentityMembershipRoleChangedPayload,
} from "./interfaces/identity-projection.consumers";
export { RecordingSessionRevocation, InMemoryKms } from "./infrastructure/in-memory-adapters";
// Reference cryptography + threat providers reused by the runtime wiring layer (H-3): the cloud KMS
// adapters delegate non-key ops (hash/verifyHash/randomToken) to NodeCrypto rather than duplicate them,
// and the resilient threat resolver reuses MultiThreatIntelResolver for fan-out + the aggregator.
export {
  NodeCrypto,
  InMemoryTotpMfaProvider,
  MapMfaProviderResolver,
} from "./infrastructure/in-memory-auth-adapters";
// Production totp MfaProviderPort (C2-4) — real RFC 6238 codes over the injected CryptoPort.
export { TotpMfaProvider } from "./infrastructure/totp-mfa-provider";
export {
  InMemoryThreatIntelProvider,
  MultiThreatIntelResolver,
} from "./infrastructure/in-memory-threat-adapters";
export { CheckConsent } from "./application/consent.use-cases";
export type { CheckConsentInput, ConsentDecision } from "./application/consent.use-cases";
export { ConsentChangedConsumer } from "./interfaces/consent-changed.consumer";
export type {
  ConsentChangedPayload,
  ConsentChangedConsumerDeps,
} from "./interfaces/consent-changed.consumer";
export {
  RelationWrittenConsumer,
  RelationDeletedConsumer,
} from "./interfaces/relation-sync.consumer";
export type {
  SecurityRelationPayload,
  RelationSyncConsumerDeps,
} from "./interfaces/relation-sync.consumer";
export { SessionRevokedAllConsumer } from "./interfaces/session-revoked-all.consumer";
export type {
  SessionRevokedAllPayload,
  SessionRevokedAllConsumerDeps,
} from "./interfaces/session-revoked-all.consumer";
export type {
  AuthenticationProviderPort,
  AuthenticationProviderResolver,
  AuthenticationRequest,
  AuthenticationResult,
  CryptoPort,
  GeoIpPort,
  MfaProviderPort,
  MfaProviderResolver,
} from "./application/auth-ports";
export type { RelationshipCheckPort, RelationshipSyncPort } from "./application/authz-ports";

// Domain aggregates
export { Principal } from "./domain/principal";
export { Credential } from "./domain/credential";
export type { CredentialKind, CredentialStatus } from "./domain/credential";
export { Session } from "./domain/session";
export type { SessionStatus } from "./domain/session";
export { Role } from "./domain/role";
export { RoleAssignment } from "./domain/role-assignment";
export { Policy, PolicyVersion } from "./domain/policy";
export type { PolicyEffect, PolicyMode, PolicyRule, PolicyCondition } from "./domain/policy";
export { Delegation } from "./domain/delegation";
export { TenantSecurityProfile } from "./domain/tenant-security-profile";
export type { TenantSecurityConfig, IsolationTier } from "./domain/tenant-security-profile";

// Domain aggregates + engines (P2.0-B)
export { Device } from "./domain/device";
export type { DeviceTrustLevel, DeviceSignal, SignalSeverity } from "./domain/device";
export { MfaEnrollment } from "./domain/mfa-enrollment";
export type { MfaEnrollmentStatus } from "./domain/mfa-enrollment";
export { RiskEngine } from "./domain/risk-engine";
export type { RiskEngineSignals, RiskFactor, RiskEvaluation } from "./domain/risk-engine";
export { MfaEngine } from "./domain/mfa-engine";
export type { MfaDecision, MfaDecisionContext } from "./domain/mfa-engine";
export {
  AUTH_METHOD_KINDS,
  MFA_METHOD_KINDS,
  isAuthMethodKind,
  isMfaMethodKind,
} from "./domain/value-objects/auth-method";
export type {
  AuthMethodKind,
  MfaMethodKind,
  MfaRequirement,
  AuthMethodSpec,
} from "./domain/value-objects/auth-method";

// Domain aggregates + engines (P2.0-C)
export { RotationPolicy } from "./domain/value-objects/rotation-policy";
export { MachineIdentityProfile } from "./domain/machine-identity-profile";
export type {
  MachineIdentityConfig,
  MachineIdentityStatus,
} from "./domain/machine-identity-profile";
export { RelationTuple, RelationshipGraph } from "./domain/relationship";
export type { RelationTupleProps, RelationQuery } from "./domain/relationship";
export { AttributeEvaluator } from "./domain/abac";
export type { AbacCondition, AbacContext, AbacResult, AbacMismatch } from "./domain/abac";

// Domain — composable policy language + compliance engine (P2.0-D)
export { PolicyExpressionEvaluator } from "./domain/policy-expression";
export type {
  PolicyExpression,
  PolicyFragment,
  FragmentResolver,
} from "./domain/policy-expression";
export { evaluateLeaf } from "./domain/policy-condition";
export type { PolicyEvalContext } from "./domain/policy-condition";
export { ComplianceEngine } from "./domain/compliance-engine";
export type {
  ComplianceControl,
  ComplianceFinding,
  ComplianceReport,
  ComplianceRulePack,
  ComplianceEvaluationContext,
  ControlSeverity,
} from "./domain/compliance-engine";
export type { MfaMethodSpec, PermissionDef } from "./domain/value-objects/auth-method";
export type { SecurityRegistryExplorer } from "./interfaces/read-models";
export type { ComplianceRulePackResolver } from "./application/compliance-ports";

// Domain — incidents + threat intelligence (P2.0-E)
export { Incident } from "./domain/incident";
export type {
  IncidentSeverity,
  IncidentStatus,
  TimelineEntry,
  EvidenceEntry,
} from "./domain/incident";
export { ThreatIntelAggregator } from "./domain/threat-intel";
export type { ThreatVerdict } from "./domain/threat-intel";
export type { ThreatIntelProvider, ThreatIntelResolver } from "./application/threat-ports";
export type { IncidentExplorer, TrustCenter, SecurityAnalytics } from "./interfaces/read-models";

// Domain — AI security governance (P2.0-F §20)
export { AiGovernanceProfile } from "./domain/ai-governance-profile";
export type {
  AiGovernanceConfig,
  AiGovernanceStatus,
  AiIsolationLevel,
  ConsumptionDecision,
} from "./domain/ai-governance-profile";
export type {
  SessionExplorer,
  PolicyExplorer,
  RiskExplorer,
  SecretExplorer,
  AiGovernanceExplorer,
} from "./interfaces/read-models";

// Domain services + primitives
export { ZeroTrustEvaluator } from "./domain/zero-trust";
export type { ZeroTrustContext, ZeroTrustDecision } from "./domain/zero-trust";
export { AuthorizationEvaluator } from "./domain/authorization";
export { AuditChain, defaultDigest, GENESIS_HASH } from "./domain/audit-chain";
export type { Digest, ChainVerification } from "./domain/audit-chain";
export { AuditRecord } from "./domain/audit-record";
export { RiskScorer, TrustScorer } from "./domain/risk";
export type { RiskSignals, TrustSignals } from "./domain/risk";

// Value objects
export { SecurityScope } from "./domain/value-objects/security-scope";
export type { ScopeLevel, SecurityScopeProps } from "./domain/value-objects/security-scope";
export { ResourceUrn } from "./domain/value-objects/resource-urn";
export { PermissionSpec } from "./domain/value-objects/permission-spec";
export { RiskScore, TrustScore } from "./domain/value-objects/scores";
export { RetentionPolicy } from "./domain/value-objects/compliance";
export type {
  DataClassification,
  LegalBasis,
  ComplianceFramework,
} from "./domain/value-objects/compliance";
export {
  PRINCIPAL_KINDS,
  isHumanKind,
  isPrincipalKind,
} from "./domain/value-objects/principal-kind";
export type { PrincipalKind, PrincipalStatus } from "./domain/value-objects/principal-kind";

/** Canonical integration events Security publishes (runtime-verified by `securityModule`). */
export { SECURITY_PUBLISHED_EVENTS } from "./infrastructure/security-event-translator";
export type { SecurityEventName } from "./domain/events/security-changed.event";
