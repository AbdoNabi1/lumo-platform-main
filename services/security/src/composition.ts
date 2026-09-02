import type { Clock, IdGenerator } from "@platform/contracts";
import type { EventSerializer } from "@platform/domain-events";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
  type Subscriber,
} from "@platform/messaging";
import {
  PrismaOutboxStore,
  PrismaUnitOfWork,
  runInTransaction,
  type Database,
  type TransactionClient,
} from "@platform/db";
import { Registry } from "@platform/registry";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { EvaluateAccess, VerifyAuditChain } from "./application/access.use-cases";
import {
  CheckAiAction,
  GovernAiIdentity,
  SuspendAiIdentity,
} from "./application/ai-governance.use-cases";
import { Authenticate, RegisterAuthMethod } from "./application/authentication.use-cases";
import {
  AssignRole,
  DefineRole,
  GrantRolePermission,
  RevokeRoleAssignment,
} from "./application/authorization.use-cases";
import {
  CheckAccess,
  DeleteRelationTuple,
  WriteRelationTuple,
} from "./application/authz.use-cases";
import {
  EmergencyRevokeCredentials,
  GetCredentialLineage,
  IssueCredential,
  RevokeCredential,
  RotateCredential,
  RotateDueCredentials,
  ScheduleCredentialRotation,
} from "./application/credential.use-cases";
import type { SecurityDeps, SecurityOutboxPort } from "./application/deps";
import { EvaluateCompliance } from "./application/compliance.use-cases";
import {
  GrantDelegation,
  RevokeDelegation,
  StartImpersonation,
} from "./application/delegation.use-cases";
import {
  BlockDevice,
  RecordDeviceSignal,
  RegisterDevice,
  TrustDevice,
} from "./application/device.use-cases";
import {
  AddIncidentEvidence,
  CloseIncident,
  MitigateIncident,
  OpenIncident,
  ResolveIncident,
  TriageIncident,
} from "./application/incident.use-cases";
import {
  GovernMachineIdentity,
  SuspendMachineIdentity,
} from "./application/machine-identity.use-cases";
import {
  RegisterComplianceRule,
  RegisterMfaMethod,
  RegisterPermission,
  RegisterPolicyFragment,
} from "./application/registry.use-cases";
import { CheckThreatIndicator } from "./application/threat.use-cases";
import {
  DecideMfa,
  EnrollMfa,
  GenerateBackupCodes,
  RevokeMfa,
  VerifyMfaEnrollment,
} from "./application/mfa.use-cases";
import {
  ArchivePolicy,
  DefinePolicy,
  PublishPolicyVersion,
  SimulatePolicy,
} from "./application/policy.use-cases";
import { RegisterPrincipal, TransitionPrincipal } from "./application/principal.use-cases";
import { EvaluateRisk } from "./application/risk.use-cases";
import {
  EstablishSession,
  FederateExternalSession,
  IntrospectSession,
  IntrospectSessionSubject,
  RefreshSession,
  RevokeAllSessions,
  RevokeSession,
} from "./application/session.use-cases";
import { ConfigureTenantSecurity } from "./application/tenant-security.use-cases";
import { AttributeEvaluator } from "./domain/abac";
import { AuditChain } from "./domain/audit-chain";
import { AuthorizationEvaluator } from "./domain/authorization";
import { ComplianceEngine, type ComplianceControl } from "./domain/compliance-engine";
import { MfaEngine } from "./domain/mfa-engine";
import type { PolicyFragment } from "./domain/policy-expression";
import { RiskEngine } from "./domain/risk-engine";
import { RiskScorer, TrustScorer } from "./domain/risk";
import { ThreatIntelAggregator } from "./domain/threat-intel";
import type {
  AuthMethodSpec,
  MfaMethodSpec,
  PermissionDef,
} from "./domain/value-objects/auth-method";
import { ZeroTrustEvaluator } from "./domain/zero-trust";
import { DefaultComplianceRulePackResolver } from "./infrastructure/compliance-packs";
import { InMemoryRelationshipCheck } from "./infrastructure/in-memory-authz-adapters";
import {
  InMemoryThreatIntelProvider,
  MultiThreatIntelResolver,
} from "./infrastructure/in-memory-threat-adapters";
import {
  InMemoryGeoIp,
  InMemoryPasswordAuthProvider,
  InMemoryTotpMfaProvider,
  MapAuthenticationProviderResolver,
  MapMfaProviderResolver,
  NodeCrypto,
} from "./infrastructure/in-memory-auth-adapters";
import {
  InMemoryDeviceTrust,
  InMemoryIdentityDirectory,
  InMemoryKms,
  InMemorySecurityTelemetry,
  RecordingSessionRevocation,
} from "./infrastructure/in-memory-adapters";
import {
  InMemoryConsentProjectionStore,
  ProjectionConsentPort,
} from "./infrastructure/consent-projection";
import { InMemoryIdentityProjectionStore } from "./infrastructure/identity-projection";
import type {
  ConsentPort,
  ConsentProjectionStore,
  IdentityDirectoryPort,
  IdentityProjectionStore,
  KmsPort,
  SessionRevocationPort,
} from "./application/ports";
import type { CryptoPort, MfaProviderResolver } from "./application/auth-ports";
import type { ThreatIntelResolver } from "./application/threat-ports";
import type { RelationshipCheckPort } from "./application/authz-ports";
import { CheckConsent } from "./application/consent.use-cases";
import {
  ResolveMachineIdentity,
  ResolveMembership,
  ResolveOrganization,
  ResolvePrincipal,
} from "./application/resolution.use-cases";
import {
  InMemoryAiGovernanceProfileRepository,
  InMemoryAuditLedgerRepository,
  InMemoryCredentialRepository,
  InMemoryDelegationRepository,
  InMemoryDeviceRepository,
  InMemoryIncidentRepository,
  InMemoryMachineIdentityProfileRepository,
  InMemoryMfaEnrollmentRepository,
  InMemoryPolicyRepository,
  InMemoryPrincipalRepository,
  InMemoryRelationTupleRepository,
  InMemoryRoleAssignmentRepository,
  InMemoryRoleRepository,
  InMemorySessionRepository,
  InMemoryTenantSecurityProfileRepository,
} from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PrismaAiGovernanceProfileRepository,
  PrismaAuditLedgerRepository,
  PrismaCredentialRepository,
  PrismaDelegationRepository,
  PrismaDeviceRepository,
  PrismaIncidentRepository,
  PrismaMachineIdentityProfileRepository,
  PrismaMfaEnrollmentRepository,
  PrismaPolicyRepository,
  PrismaPrincipalRepository,
  PrismaRelationTupleRepository,
  PrismaRoleAssignmentRepository,
  PrismaRoleRepository,
  PrismaSessionRepository,
  PrismaTenantSecurityProfileRepository,
} from "./infrastructure/prisma-repositories";
import {
  SecurityEventTranslator,
  SECURITY_PUBLISHED_EVENTS,
} from "./infrastructure/security-event-translator";
import { SecurityController } from "./interfaces/security.controller";
import { SecurityConsoleReadModels } from "./interfaces/read-models";
import { SecuritySdk } from "./interfaces/security-sdk";

export interface SecurityWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Production persistence (G-SEC-1). Present ⇒ Postgres-backed Prisma repositories; absent ⇒ in-memory (tests). */
  readonly prisma?: Database;
  /** Row scope for every Prisma query/write (ADR-0008) — required when `prisma` is provided. */
  readonly tenantId?: string;
  /** Seed known Identity subject refs so human principals can be registered offline (tests). */
  readonly knownSubjects?: readonly string[];
  /** Seed trusted device refs (tests). */
  readonly trustedDevices?: readonly string[];
  // ── H-2 (G-SEC-4) live identity binding — optional production adapters. Absent ⇒ in-memory. ──
  /** Live identity directory (Kratos) — resolves human `subjectRef` existence/status. */
  readonly identityDirectory?: IdentityDirectoryPort;
  /** Live ReBAC check (Keto) — the enforcement-aligned relationship decision. */
  readonly relationshipCheck?: RelationshipCheckPort;
  /** Shared consent projection store (Prisma in production) the ConsentPort + consumer both use. */
  readonly consentStore?: ConsentProjectionStore;
  /** Consent read port (defaults to a projection port over `consentStore`). */
  readonly consent?: ConsentPort;
  /** Shared Identity projection store (Prisma in production) the resolution use-cases + consumers use. */
  readonly identityProjection?: IdentityProjectionStore;
  /** Session revocation sync (Kratos) — propagates "revoke all" to the enforcement point. */
  readonly sessionRevocation?: SessionRevocationPort;
  // ── H-3 (G-SEC-2) cloud cryptography + threat-intel — optional production providers. Absent ⇒ local. ──
  /** Live key-management (AWS KMS / GCP KMS / Azure Key Vault / HashiCorp Vault). Absent ⇒ in-memory KMS. */
  readonly kms?: KmsPort;
  /** Live cryptography provider (Vault Transit / cloud KMS / HSM-backed). Absent ⇒ `node:crypto`. */
  readonly crypto?: CryptoPort;
  /** Live threat-intel resolver (CrowdStrike / Cloudflare / Defender / AbuseIPDB / VirusTotal / OTX, resilient). Absent ⇒ reference feed. */
  readonly threatIntel?: ThreatIntelResolver;
  /**
   * Production MFA provider resolver (C2-4). Absent ⇒ `MapMfaProviderResolver([InMemoryTotpMfaProvider()])`
   * — a reference/test stub whose `verify()` checks a single hardcoded code, never a real one-time
   * proof of possession. Same `deps.X ?? default` convention as `identityDirectory`/`kms`/`crypto`
   * above; the composition layer that knows the deployment environment (`apps/runtime`) is
   * responsible for refusing to boot outside `local` without a real one injected here.
   */
  readonly mfaProviders?: MfaProviderResolver;
}

/** The persistence + outbox infrastructure — Prisma-backed in production, in-memory for tests. */
interface SecurityInfra {
  readonly principals: PrismaPrincipalRepository | InMemoryPrincipalRepository;
  readonly credentials: PrismaCredentialRepository | InMemoryCredentialRepository;
  readonly sessions: PrismaSessionRepository | InMemorySessionRepository;
  readonly roles: PrismaRoleRepository | InMemoryRoleRepository;
  readonly assignments: PrismaRoleAssignmentRepository | InMemoryRoleAssignmentRepository;
  readonly policies: PrismaPolicyRepository | InMemoryPolicyRepository;
  readonly delegations: PrismaDelegationRepository | InMemoryDelegationRepository;
  readonly tenantProfiles:
    PrismaTenantSecurityProfileRepository | InMemoryTenantSecurityProfileRepository;
  readonly devices: PrismaDeviceRepository | InMemoryDeviceRepository;
  readonly mfaEnrollments: PrismaMfaEnrollmentRepository | InMemoryMfaEnrollmentRepository;
  readonly machineProfiles:
    PrismaMachineIdentityProfileRepository | InMemoryMachineIdentityProfileRepository;
  readonly relationTuples: PrismaRelationTupleRepository | InMemoryRelationTupleRepository;
  readonly incidents: PrismaIncidentRepository | InMemoryIncidentRepository;
  readonly aiProfiles: PrismaAiGovernanceProfileRepository | InMemoryAiGovernanceProfileRepository;
  readonly auditLedger: PrismaAuditLedgerRepository | InMemoryAuditLedgerRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly securityOutbox: SecurityOutboxPort;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: string[];
}

/**
 * Builds the persistence/outbox infrastructure. With `prisma` present it is the production
 * Postgres-backed slice (G-SEC-1): Prisma repositories, the transactional outbox (same-tx delivery),
 * and a `PrismaUnitOfWork`; out-of-transaction publishes each run in their own transaction. Without
 * it, the in-memory slice + relay drives offline tests. No in-memory repositories remain in production.
 */
function buildInfra(deps: SecurityWiringDeps): SecurityInfra {
  const translator = new SecurityEventTranslator();
  if (deps.prisma !== undefined) {
    const prisma = deps.prisma;
    const tenantId = deps.tenantId;
    if (tenantId === undefined)
      throw new Error("wireSecurity: tenantId is required when prisma is provided (ADR-0008).");
    const outbox = new OutboxWriter<TransactionClient>({
      store: new PrismaOutboxStore(prisma),
      translator,
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "security",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const rd = { prisma, outbox, context, tenantId };
    return {
      principals: new PrismaPrincipalRepository(rd),
      credentials: new PrismaCredentialRepository(rd),
      sessions: new PrismaSessionRepository(rd),
      roles: new PrismaRoleRepository(rd),
      assignments: new PrismaRoleAssignmentRepository(rd),
      policies: new PrismaPolicyRepository(rd),
      delegations: new PrismaDelegationRepository(rd),
      tenantProfiles: new PrismaTenantSecurityProfileRepository(rd),
      devices: new PrismaDeviceRepository(rd),
      mfaEnrollments: new PrismaMfaEnrollmentRepository(rd),
      machineProfiles: new PrismaMachineIdentityProfileRepository(rd),
      relationTuples: new PrismaRelationTupleRepository(rd),
      incidents: new PrismaIncidentRepository(rd),
      aiProfiles: new PrismaAiGovernanceProfileRepository(rd),
      auditLedger: new PrismaAuditLedgerRepository(rd),
      unitOfWork: new PrismaUnitOfWork(prisma),
      securityOutbox: {
        publish: (events, tx) =>
          tx !== undefined
            ? outbox.write(events, context, tx as TransactionClient)
            : runInTransaction(prisma, (client) => outbox.write(events, context, client)),
      },
      drainOutbox: async () => 0, // the OutboxRelay runs in the worker entrypoint in production
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator,
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "security",
  });
  const context = rootEventContext(deps.idGenerator);
  const rd = { outbox, context };
  const delivered: string[] = [];
  const bus = new InMemoryEventBus();
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const type of SECURITY_PUBLISHED_EVENTS) bus.subscribe(`${type}.v1`, sink);
  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });
  return {
    principals: new InMemoryPrincipalRepository(rd),
    credentials: new InMemoryCredentialRepository(rd),
    sessions: new InMemorySessionRepository(rd),
    roles: new InMemoryRoleRepository(rd),
    assignments: new InMemoryRoleAssignmentRepository(rd),
    policies: new InMemoryPolicyRepository(rd),
    delegations: new InMemoryDelegationRepository(rd),
    tenantProfiles: new InMemoryTenantSecurityProfileRepository(rd),
    devices: new InMemoryDeviceRepository(rd),
    mfaEnrollments: new InMemoryMfaEnrollmentRepository(rd),
    machineProfiles: new InMemoryMachineIdentityProfileRepository(rd),
    relationTuples: new InMemoryRelationTupleRepository(),
    incidents: new InMemoryIncidentRepository(rd),
    aiProfiles: new InMemoryAiGovernanceProfileRepository(rd),
    auditLedger: new InMemoryAuditLedgerRepository(),
    unitOfWork: new InMemoryUnitOfWork(),
    securityOutbox: { publish: (events, tx) => outbox.write(events, context, tx) },
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}

export interface WiredSecurity {
  readonly security: SecurityController;
  readonly sdk: SecuritySdk;
  readonly identityDirectory: InMemoryIdentityDirectory;
  readonly deviceTrust: InMemoryDeviceTrust;
  readonly telemetry: InMemorySecurityTelemetry;
  /** Reference auth/MFA/geo adapters exposed so tests (and local dev) can seed them. */
  readonly passwordProvider: InMemoryPasswordAuthProvider;
  readonly totpProvider: InMemoryTotpMfaProvider;
  readonly geoIp: InMemoryGeoIp;
  readonly threatProvider: InMemoryThreatIntelProvider;
  /** The consent projection the ConsentPort reads + the consent consumer writes (H-2). */
  readonly consentStore: ConsentProjectionStore;
  /** The Identity projection the resolution use-cases read + the identity consumers write (H-2). */
  readonly identityProjection: IdentityProjectionStore;
  /** Session-revocation sync port (in-memory recorder offline; Kratos in production) (H-2). */
  readonly sessionRevocation: SessionRevocationPort;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/**
 * Composition root for the Security context. Wires the in-memory slice (durable Prisma slice = gap
 * G-SEC-1) with the transactional outbox + event relay, the Registry Engine for auth methods, the
 * cryptography/auth/MFA/geo provider adapters and every use-case. Side-effect-free graph → testable
 * without Docker.
 */
export function wireSecurity(deps: SecurityWiringDeps): WiredSecurity {
  const infra = buildInfra(deps);
  const {
    principals,
    credentials,
    sessions,
    roles,
    assignments,
    policies,
    delegations,
    tenantProfiles,
    devices,
    mfaEnrollments,
    machineProfiles,
    relationTuples,
    incidents,
    aiProfiles,
    auditLedger,
  } = infra;

  const identityDirectoryDefault = new InMemoryIdentityDirectory(deps.knownSubjects ?? []);
  const identityDirectory: IdentityDirectoryPort =
    deps.identityDirectory ?? identityDirectoryDefault;
  const deviceTrust = new InMemoryDeviceTrust(deps.trustedDevices ?? []);
  // H-2 (G-SEC-4): consent read from Identity events + session-revocation sync. The store is shared so
  // the in-context ConsentPort and the ConsentChangedConsumer see the same projection (one DB / one map).
  const consentStore: ConsentProjectionStore =
    deps.consentStore ?? new InMemoryConsentProjectionStore();
  const consent: ConsentPort = deps.consent ?? new ProjectionConsentPort(consentStore);
  const identityProjection: IdentityProjectionStore =
    deps.identityProjection ?? new InMemoryIdentityProjectionStore();
  const sessionRevocation: SessionRevocationPort =
    deps.sessionRevocation ?? new RecordingSessionRevocation();
  const telemetry = new InMemorySecurityTelemetry();
  // H-3 (G-SEC-2): cloud KMS/HSM/Vault + threat-intel bind here as optional overrides; absent ⇒ the
  // offline reference providers. The concrete AWS/GCP/Azure/Vault + threat adapters live in the runtime
  // wiring layer so the context stays vendor-agnostic (like the Ory adapters, ADR-0023).
  const kms: KmsPort = deps.kms ?? new InMemoryKms();
  const crypto: CryptoPort = deps.crypto ?? new NodeCrypto();
  const geoIp = new InMemoryGeoIp();
  const auditChain = new AuditChain();

  const passwordProvider = new InMemoryPasswordAuthProvider();
  const totpProvider = new InMemoryTotpMfaProvider();
  const authProviders = new MapAuthenticationProviderResolver([passwordProvider]);
  // C2-4: `deps.mfaProviders` overrides the hardcoded-code reference stub — same seam pattern as
  // identityDirectory/kms/crypto below. Still exposed via WiredSecurity.totpProvider unconditionally
  // (tests/local dev seed it directly), but it only backs LIVE verification when nothing real was injected.
  const mfaProviders: MfaProviderResolver =
    deps.mfaProviders ?? new MapMfaProviderResolver([totpProvider]);
  const now = (): Date => deps.clock.now();
  const authMethodRegistry = new Registry<AuthMethodSpec>({ name: "security-auth-methods", now });
  const mfaMethodRegistry = new Registry<MfaMethodSpec>({ name: "security-mfa-methods", now });
  const permissionRegistry = new Registry<PermissionDef>({ name: "security-permissions", now });
  const policyFragments = new Registry<PolicyFragment>({ name: "security-policy-fragments", now });
  const complianceControlRegistry = new Registry<ComplianceControl>({
    name: "security-compliance-controls",
    now,
  });
  const fragmentResolver = {
    resolve: (key: string) => policyFragments.get(key)?.value.expression ?? null,
  };
  const complianceRulePacks = new DefaultComplianceRulePackResolver();
  const threatProvider = new InMemoryThreatIntelProvider("reference-feed");
  const threatIntel: ThreatIntelResolver =
    deps.threatIntel ?? new MultiThreatIntelResolver([threatProvider]);

  const securityDeps: SecurityDeps = {
    principals,
    credentials,
    sessions,
    roles,
    assignments,
    policies,
    delegations,
    tenantProfiles,
    auditLedger,
    unitOfWork: infra.unitOfWork,
    outbox: infra.securityOutbox,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
    kms,
    identityDirectory,
    consent,
    identityProjection,
    sessionRevocation,
    deviceTrust,
    telemetry,
    auditChain,
    authorization: new AuthorizationEvaluator(),
    zeroTrust: new ZeroTrustEvaluator(),
    riskScorer: new RiskScorer(),
    trustScorer: new TrustScorer(),
    devices,
    mfaEnrollments,
    crypto,
    geoIp,
    authProviders,
    mfaProviders,
    riskEngine: new RiskEngine(),
    mfaEngine: new MfaEngine(),
    authMethodRegistry,
    machineProfiles,
    relationTuples,
    relationshipCheck: deps.relationshipCheck ?? new InMemoryRelationshipCheck(relationTuples),
    attributeEvaluator: new AttributeEvaluator(),
    policyFragments,
    fragmentResolver,
    mfaMethodRegistry,
    permissionRegistry,
    complianceControlRegistry,
    complianceEngine: new ComplianceEngine(),
    complianceRulePacks,
    incidents,
    threatIntel,
    threatAggregator: new ThreatIntelAggregator(),
    aiProfiles,
  };

  const readModels = new SecurityConsoleReadModels({
    principals,
    roles,
    policies,
    devices,
    machineProfiles,
    incidents,
    sessions,
    credentials,
    aiProfiles,
    auditLedger,
    auditChain,
    telemetry,
    authMethodRegistry,
    mfaMethodRegistry,
    permissionRegistry,
    policyFragments,
    complianceControlRegistry,
  });

  // Use-case instances (shared by the controller + SDK).
  const registerPrincipal = new RegisterPrincipal(securityDeps);
  const transitionPrincipal = new TransitionPrincipal(securityDeps);
  const issueCredential = new IssueCredential(securityDeps);
  const rotateCredential = new RotateCredential(securityDeps);
  const revokeCredential = new RevokeCredential(securityDeps);
  const establishSession = new EstablishSession(securityDeps);
  const federateExternalSession = new FederateExternalSession(securityDeps);
  const refreshSession = new RefreshSession(securityDeps);
  const revokeSession = new RevokeSession(securityDeps);
  const revokeAllSessions = new RevokeAllSessions(securityDeps);
  const introspectSession = new IntrospectSession(securityDeps);
  const introspectSessionSubject = new IntrospectSessionSubject(securityDeps);
  const defineRole = new DefineRole(securityDeps);
  const grantRolePermission = new GrantRolePermission(securityDeps);
  const assignRole = new AssignRole(securityDeps);
  const revokeRoleAssignment = new RevokeRoleAssignment(securityDeps);
  const definePolicy = new DefinePolicy(securityDeps);
  const publishPolicyVersion = new PublishPolicyVersion(securityDeps);
  const archivePolicy = new ArchivePolicy(securityDeps);
  const simulatePolicy = new SimulatePolicy(securityDeps);
  const grantDelegation = new GrantDelegation(securityDeps);
  const revokeDelegation = new RevokeDelegation(securityDeps);
  const startImpersonation = new StartImpersonation(securityDeps);
  const configureTenantSecurity = new ConfigureTenantSecurity(securityDeps);
  const evaluateAccess = new EvaluateAccess(securityDeps);
  const verifyAuditChain = new VerifyAuditChain(securityDeps);
  const registerAuthMethod = new RegisterAuthMethod(securityDeps);
  const authenticate = new Authenticate(securityDeps);
  const registerDevice = new RegisterDevice(securityDeps);
  const recordDeviceSignal = new RecordDeviceSignal(securityDeps);
  const trustDevice = new TrustDevice(securityDeps);
  const blockDevice = new BlockDevice(securityDeps);
  const enrollMfa = new EnrollMfa(securityDeps);
  const verifyMfaEnrollment = new VerifyMfaEnrollment(securityDeps);
  const generateBackupCodes = new GenerateBackupCodes(securityDeps);
  const revokeMfa = new RevokeMfa(securityDeps);
  const decideMfa = new DecideMfa(securityDeps);
  const evaluateRisk = new EvaluateRisk(securityDeps);
  const scheduleCredentialRotation = new ScheduleCredentialRotation(securityDeps);
  const rotateDueCredentials = new RotateDueCredentials(securityDeps);
  const emergencyRevokeCredentials = new EmergencyRevokeCredentials(securityDeps);
  const getCredentialLineage = new GetCredentialLineage(securityDeps);
  const governMachineIdentity = new GovernMachineIdentity(securityDeps);
  const suspendMachineIdentity = new SuspendMachineIdentity(securityDeps);
  const writeRelationTuple = new WriteRelationTuple(securityDeps);
  const deleteRelationTuple = new DeleteRelationTuple(securityDeps);
  const checkAccess = new CheckAccess(securityDeps);
  const checkConsent = new CheckConsent(securityDeps);
  const resolvePrincipal = new ResolvePrincipal(securityDeps);
  const resolveMembership = new ResolveMembership(securityDeps);
  const resolveOrganization = new ResolveOrganization(securityDeps);
  const resolveMachineIdentity = new ResolveMachineIdentity(securityDeps);
  const registerPolicyFragment = new RegisterPolicyFragment(securityDeps);
  const registerMfaMethod = new RegisterMfaMethod(securityDeps);
  const registerPermission = new RegisterPermission(securityDeps);
  const registerComplianceRule = new RegisterComplianceRule(securityDeps);
  const evaluateCompliance = new EvaluateCompliance(securityDeps);
  const openIncident = new OpenIncident(securityDeps);
  const triageIncident = new TriageIncident(securityDeps);
  const mitigateIncident = new MitigateIncident(securityDeps);
  const resolveIncident = new ResolveIncident(securityDeps);
  const closeIncident = new CloseIncident(securityDeps);
  const addIncidentEvidence = new AddIncidentEvidence(securityDeps);
  const checkThreatIndicator = new CheckThreatIndicator(securityDeps);
  const governAiIdentity = new GovernAiIdentity(securityDeps);
  const suspendAiIdentity = new SuspendAiIdentity(securityDeps);
  const checkAiAction = new CheckAiAction(securityDeps);

  const controller = new SecurityController({
    registerPrincipal,
    transitionPrincipal,
    issueCredential,
    rotateCredential,
    revokeCredential,
    establishSession,
    refreshSession,
    revokeSession,
    introspectSession,
    introspectSessionSubject,
    defineRole,
    grantRolePermission,
    assignRole,
    revokeRoleAssignment,
    definePolicy,
    publishPolicyVersion,
    archivePolicy,
    simulatePolicy,
    grantDelegation,
    revokeDelegation,
    startImpersonation,
    configureTenantSecurity,
    evaluateAccess,
    verifyAuditChain,
    registerAuthMethod,
    authenticate,
    registerDevice,
    recordDeviceSignal,
    trustDevice,
    blockDevice,
    enrollMfa,
    verifyMfaEnrollment,
    generateBackupCodes,
    revokeMfa,
    decideMfa,
    evaluateRisk,
    revokeAllSessions,
    scheduleCredentialRotation,
    rotateDueCredentials,
    emergencyRevokeCredentials,
    getCredentialLineage,
    governMachineIdentity,
    suspendMachineIdentity,
    writeRelationTuple,
    deleteRelationTuple,
    checkAccess,
    checkConsent,
    resolvePrincipal,
    resolveMembership,
    resolveOrganization,
    resolveMachineIdentity,
    registerPolicyFragment,
    registerMfaMethod,
    registerPermission,
    registerComplianceRule,
    evaluateCompliance,
    openIncident,
    triageIncident,
    mitigateIncident,
    resolveIncident,
    closeIncident,
    addIncidentEvidence,
    checkThreatIndicator,
    governAiIdentity,
    suspendAiIdentity,
    checkAiAction,
    readModels,
  });

  const sdk = new SecuritySdk({
    authenticate,
    evaluateAccess,
    evaluateRisk,
    simulatePolicy,
    rotateCredential,
    revokeAllSessions,
    federateExternalSession,
    trustDevice,
    enrollMfa,
  });

  return {
    security: controller,
    sdk,
    identityDirectory: identityDirectoryDefault,
    deviceTrust,
    telemetry,
    passwordProvider,
    totpProvider,
    geoIp,
    threatProvider,
    consentStore,
    identityProjection,
    sessionRevocation,
    drainOutbox: infra.drainOutbox,
    deliveredEventTypes: infra.deliveredEventTypes,
  };
}
