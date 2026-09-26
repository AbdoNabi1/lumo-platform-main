import type {
  EvaluateAccess,
  EvaluateAccessInput,
  VerifyAuditChain,
  VerifyAuditChainInput,
} from "../application/access.use-cases";
import type {
  Authenticate,
  AuthenticateInput,
  RegisterAuthMethod,
  RegisterAuthMethodInput,
} from "../application/authentication.use-cases";
import type {
  BlockDevice,
  DeviceActionInput,
  RecordDeviceSignal,
  RecordDeviceSignalInput,
  RegisterDevice,
  RegisterDeviceInput,
  TrustDevice,
} from "../application/device.use-cases";
import type {
  DecideMfa,
  DecideMfaInput,
  EnrollMfa,
  EnrollMfaInput,
  GenerateBackupCodes,
  GenerateBackupCodesInput,
  RevokeMfa,
  RevokeMfaInput,
  VerifyMfaEnrollment,
  VerifyMfaInput,
} from "../application/mfa.use-cases";
import type {
  CheckAccess,
  CheckAccessInput,
  DeleteRelationTuple,
  RelationTupleInput,
  WriteRelationTuple,
} from "../application/authz.use-cases";
import type { CheckConsent, CheckConsentInput } from "../application/consent.use-cases";
import type {
  ResolveMachineIdentity,
  ResolveMachineIdentityInput,
  ResolveMembership,
  ResolveMembershipInput,
  ResolveOrganization,
  ResolveOrganizationInput,
  ResolvePrincipal,
  ResolvePrincipalInput,
} from "../application/resolution.use-cases";
import type {
  CredentialLineageInput,
  EmergencyRevokeCredentials,
  EmergencyRevokeCredentialsInput,
  GetCredentialLineage,
  RotateDueCredentials,
  RotateDueCredentialsInput,
  ScheduleCredentialRotation,
  ScheduleCredentialRotationInput,
} from "../application/credential.use-cases";
import type {
  GovernMachineIdentity,
  GovernMachineIdentityInput,
  SuspendMachineIdentity,
  SuspendMachineIdentityInput,
} from "../application/machine-identity.use-cases";
import type {
  EvaluateCompliance,
  EvaluateComplianceInput,
} from "../application/compliance.use-cases";
import type {
  AddIncidentEvidence,
  AddIncidentEvidenceInput,
  CloseIncident,
  IncidentNoteInput,
  MitigateIncident,
  OpenIncident,
  OpenIncidentInput,
  ResolveIncident,
  ResolveIncidentInput,
  TriageIncident,
  TriageIncidentInput,
} from "../application/incident.use-cases";
import type {
  CheckThreatIndicator,
  CheckThreatIndicatorInput,
} from "../application/threat.use-cases";
import type {
  CheckAiAction,
  CheckAiActionInput,
  GovernAiIdentity,
  GovernAiIdentityInput,
  SuspendAiIdentity,
  SuspendAiIdentityInput,
} from "../application/ai-governance.use-cases";
import type {
  RegisterComplianceRule,
  RegisterComplianceRuleInput,
  RegisterMfaMethod,
  RegisterMfaMethodInput,
  RegisterPermission,
  RegisterPermissionInput,
  RegisterPolicyFragment,
  RegisterPolicyFragmentInput,
} from "../application/registry.use-cases";
import type { EvaluateRisk, EvaluateRiskInput } from "../application/risk.use-cases";
import type { RevokeAllSessions, RevokeAllSessionsInput } from "../application/session.use-cases";
import type {
  AssignRole,
  AssignRoleInput,
  DefineRole,
  DefineRoleInput,
  GrantRolePermission,
  GrantRolePermissionInput,
  RevokeRoleAssignment,
  RevokeRoleAssignmentInput,
} from "../application/authorization.use-cases";
import type {
  IssueCredential,
  IssueCredentialInput,
  RevokeCredential,
  RevokeCredentialInput,
  RotateCredential,
  RotateCredentialInput,
} from "../application/credential.use-cases";
import type {
  GrantDelegation,
  GrantDelegationInput,
  RevokeDelegation,
  RevokeDelegationInput,
  StartImpersonation,
  StartImpersonationInput,
} from "../application/delegation.use-cases";
import type {
  ArchivePolicy,
  ArchivePolicyInput,
  DefinePolicy,
  DefinePolicyInput,
  PublishPolicyVersion,
  PublishPolicyVersionInput,
  SimulatePolicy,
  SimulatePolicyInput,
} from "../application/policy.use-cases";
import type {
  RegisterPrincipal,
  RegisterPrincipalInput,
  TransitionPrincipal,
  TransitionPrincipalInput,
} from "../application/principal.use-cases";
import type {
  EstablishSession,
  EstablishSessionInput,
  IntrospectSession,
  IntrospectSessionInput,
  IntrospectSessionSubject,
  IntrospectSessionSubjectInput,
  RefreshSession,
  RefreshSessionInput,
  RevokeSession,
  RevokeSessionInput,
} from "../application/session.use-cases";
import type {
  ConfigureTenantSecurity,
  ConfigureTenantSecurityInput,
} from "../application/tenant-security.use-cases";
import { present, type ControllerResponse } from "./presenter";
import type {
  AiGovernanceExplorer,
  AuditExplorer,
  DeviceExplorer,
  IdentityOverview,
  IncidentExplorer,
  MachineIdentityExplorer,
  PermissionExplorer,
  PolicyExplorer,
  RiskExplorer,
  SecretExplorer,
  SecurityAnalytics,
  SecurityConsoleReadModels,
  TenantBaselineState,
  SecurityDashboard,
  SecurityRegistryExplorer,
  SessionExplorer,
  TrustCenter,
} from "./read-models";

export interface SecurityControllerDeps {
  // Identity
  readonly registerPrincipal: RegisterPrincipal;
  readonly transitionPrincipal: TransitionPrincipal;
  // Credentials
  readonly issueCredential: IssueCredential;
  readonly rotateCredential: RotateCredential;
  readonly revokeCredential: RevokeCredential;
  // Sessions
  readonly establishSession: EstablishSession;
  readonly refreshSession: RefreshSession;
  readonly revokeSession: RevokeSession;
  readonly introspectSession: IntrospectSession;
  /** T5.17 — resolves a session to its Identity subject (customer-facing session validation). */
  readonly introspectSessionSubject: IntrospectSessionSubject;
  // Authorization
  readonly defineRole: DefineRole;
  readonly grantRolePermission: GrantRolePermission;
  readonly assignRole: AssignRole;
  readonly revokeRoleAssignment: RevokeRoleAssignment;
  // Policy
  readonly definePolicy: DefinePolicy;
  readonly publishPolicyVersion: PublishPolicyVersion;
  readonly archivePolicy: ArchivePolicy;
  readonly simulatePolicy: SimulatePolicy;
  // Delegation
  readonly grantDelegation: GrantDelegation;
  readonly revokeDelegation: RevokeDelegation;
  readonly startImpersonation: StartImpersonation;
  // Tenant security
  readonly configureTenantSecurity: ConfigureTenantSecurity;
  // Zero-trust + audit
  readonly evaluateAccess: EvaluateAccess;
  readonly verifyAuditChain: VerifyAuditChain;
  // P2.0-B — authentication, MFA, device, risk
  readonly registerAuthMethod: RegisterAuthMethod;
  readonly authenticate: Authenticate;
  readonly registerDevice: RegisterDevice;
  readonly recordDeviceSignal: RecordDeviceSignal;
  readonly trustDevice: TrustDevice;
  readonly blockDevice: BlockDevice;
  readonly enrollMfa: EnrollMfa;
  readonly verifyMfaEnrollment: VerifyMfaEnrollment;
  readonly generateBackupCodes: GenerateBackupCodes;
  readonly revokeMfa: RevokeMfa;
  readonly decideMfa: DecideMfa;
  readonly evaluateRisk: EvaluateRisk;
  readonly revokeAllSessions: RevokeAllSessions;
  // P2.0-C — secret rotation, machine identity, ABAC/ReBAC
  readonly scheduleCredentialRotation: ScheduleCredentialRotation;
  readonly rotateDueCredentials: RotateDueCredentials;
  readonly emergencyRevokeCredentials: EmergencyRevokeCredentials;
  readonly getCredentialLineage: GetCredentialLineage;
  readonly governMachineIdentity: GovernMachineIdentity;
  readonly suspendMachineIdentity: SuspendMachineIdentity;
  readonly writeRelationTuple: WriteRelationTuple;
  readonly deleteRelationTuple: DeleteRelationTuple;
  readonly checkAccess: CheckAccess;
  // H-2 (G-SEC-4) — consent read + live identity resolution projected from Identity events
  readonly checkConsent: CheckConsent;
  readonly resolvePrincipal: ResolvePrincipal;
  readonly resolveMembership: ResolveMembership;
  readonly resolveOrganization: ResolveOrganization;
  readonly resolveMachineIdentity: ResolveMachineIdentity;
  // P2.0-D — policy language, security registry, compliance
  readonly registerPolicyFragment: RegisterPolicyFragment;
  readonly registerMfaMethod: RegisterMfaMethod;
  readonly registerPermission: RegisterPermission;
  readonly registerComplianceRule: RegisterComplianceRule;
  readonly evaluateCompliance: EvaluateCompliance;
  // P2.0-E — incidents, threat intelligence
  readonly openIncident: OpenIncident;
  readonly triageIncident: TriageIncident;
  readonly mitigateIncident: MitigateIncident;
  readonly resolveIncident: ResolveIncident;
  readonly closeIncident: CloseIncident;
  readonly addIncidentEvidence: AddIncidentEvidence;
  readonly checkThreatIndicator: CheckThreatIndicator;
  // P2.0-F — AI security governance
  readonly governAiIdentity: GovernAiIdentity;
  readonly suspendAiIdentity: SuspendAiIdentity;
  readonly checkAiAction: CheckAiAction;
  // Console read models
  readonly readModels: SecurityConsoleReadModels;
}

/**
 * Framework-agnostic interface boundary for the Security context (no HTTP server). Commands return
 * a transport-neutral {@link ControllerResponse}; console queries return read models directly.
 * Enforcement is not performed here — Security decides; the runtime pipeline / Keto enforce (ADR-0023).
 */
export class SecurityController {
  constructor(private readonly deps: SecurityControllerDeps) {}

  // ── Identity ──────────────────────────────────────────────────────────────
  async registerPrincipal(input: RegisterPrincipalInput): Promise<ControllerResponse> {
    return present(await this.deps.registerPrincipal.execute(input), 201);
  }
  async transitionPrincipal(input: TransitionPrincipalInput): Promise<ControllerResponse> {
    return present(await this.deps.transitionPrincipal.execute(input), 200);
  }

  // ── Credentials ───────────────────────────────────────────────────────────
  async issueCredential(input: IssueCredentialInput): Promise<ControllerResponse> {
    return present(await this.deps.issueCredential.execute(input), 201);
  }
  async rotateCredential(input: RotateCredentialInput): Promise<ControllerResponse> {
    return present(await this.deps.rotateCredential.execute(input), 200);
  }
  async revokeCredential(input: RevokeCredentialInput): Promise<ControllerResponse> {
    return present(await this.deps.revokeCredential.execute(input), 200);
  }

  // ── Sessions ──────────────────────────────────────────────────────────────
  async establishSession(input: EstablishSessionInput): Promise<ControllerResponse> {
    return present(await this.deps.establishSession.execute(input), 201);
  }
  async refreshSession(input: RefreshSessionInput): Promise<ControllerResponse> {
    return present(await this.deps.refreshSession.execute(input), 200);
  }
  async revokeSession(input: RevokeSessionInput): Promise<ControllerResponse> {
    return present(await this.deps.revokeSession.execute(input), 200);
  }
  async introspectSession(input: IntrospectSessionInput): Promise<ControllerResponse> {
    return present(await this.deps.introspectSession.execute(input), 200);
  }
  /**
   * T5.17 — session → principal → Identity-subject resolution. Always 200: an unknown, expired,
   * revoked or non-human session resolves to `{active: false}`, never a 404, so this cannot be used
   * to probe which sessions exist (see {@link IntrospectSessionSubject}'s doc comment).
   */
  async introspectSessionSubject(
    input: IntrospectSessionSubjectInput,
  ): Promise<ControllerResponse> {
    return present(await this.deps.introspectSessionSubject.execute(input), 200);
  }

  // ── Authorization ─────────────────────────────────────────────────────────
  async defineRole(input: DefineRoleInput): Promise<ControllerResponse> {
    return present(await this.deps.defineRole.execute(input), 201);
  }
  async grantRolePermission(input: GrantRolePermissionInput): Promise<ControllerResponse> {
    return present(await this.deps.grantRolePermission.execute(input), 200);
  }
  async assignRole(input: AssignRoleInput): Promise<ControllerResponse> {
    return present(await this.deps.assignRole.execute(input), 201);
  }
  async revokeRoleAssignment(input: RevokeRoleAssignmentInput): Promise<ControllerResponse> {
    return present(await this.deps.revokeRoleAssignment.execute(input), 200);
  }

  // ── Policy ────────────────────────────────────────────────────────────────
  async definePolicy(input: DefinePolicyInput): Promise<ControllerResponse> {
    return present(await this.deps.definePolicy.execute(input), 201);
  }
  async publishPolicyVersion(input: PublishPolicyVersionInput): Promise<ControllerResponse> {
    return present(await this.deps.publishPolicyVersion.execute(input), 200);
  }
  async archivePolicy(input: ArchivePolicyInput): Promise<ControllerResponse> {
    return present(await this.deps.archivePolicy.execute(input), 200);
  }
  async simulatePolicy(input: SimulatePolicyInput): Promise<ControllerResponse> {
    return present(await this.deps.simulatePolicy.execute(input), 200);
  }

  // ── Delegation ────────────────────────────────────────────────────────────
  async grantDelegation(input: GrantDelegationInput): Promise<ControllerResponse> {
    return present(await this.deps.grantDelegation.execute(input), 201);
  }
  async revokeDelegation(input: RevokeDelegationInput): Promise<ControllerResponse> {
    return present(await this.deps.revokeDelegation.execute(input), 200);
  }
  async startImpersonation(input: StartImpersonationInput): Promise<ControllerResponse> {
    return present(await this.deps.startImpersonation.execute(input), 201);
  }

  // ── Tenant security ───────────────────────────────────────────────────────
  async configureTenantSecurity(input: ConfigureTenantSecurityInput): Promise<ControllerResponse> {
    return present(await this.deps.configureTenantSecurity.execute(input), 200);
  }

  // ── Zero-trust + audit ────────────────────────────────────────────────────
  async evaluateAccess(input: EvaluateAccessInput): Promise<ControllerResponse> {
    return present(await this.deps.evaluateAccess.execute(input), 200);
  }
  async verifyAuditChain(input: VerifyAuditChainInput): Promise<ControllerResponse> {
    return present(await this.deps.verifyAuditChain.execute(input), 200);
  }

  // ── Authentication + MFA + device + risk (P2.0-B) ─────────────────────────
  async registerAuthMethod(input: RegisterAuthMethodInput): Promise<ControllerResponse> {
    return present(await this.deps.registerAuthMethod.execute(input), 201);
  }
  async authenticate(input: AuthenticateInput): Promise<ControllerResponse> {
    return present(await this.deps.authenticate.execute(input), 200);
  }
  async registerDevice(input: RegisterDeviceInput): Promise<ControllerResponse> {
    return present(await this.deps.registerDevice.execute(input), 201);
  }
  async recordDeviceSignal(input: RecordDeviceSignalInput): Promise<ControllerResponse> {
    return present(await this.deps.recordDeviceSignal.execute(input), 200);
  }
  async trustDevice(input: DeviceActionInput): Promise<ControllerResponse> {
    return present(await this.deps.trustDevice.execute(input), 200);
  }
  async blockDevice(input: DeviceActionInput): Promise<ControllerResponse> {
    return present(await this.deps.blockDevice.execute(input), 200);
  }
  async enrollMfa(input: EnrollMfaInput): Promise<ControllerResponse> {
    return present(await this.deps.enrollMfa.execute(input), 201);
  }
  async verifyMfaEnrollment(input: VerifyMfaInput): Promise<ControllerResponse> {
    return present(await this.deps.verifyMfaEnrollment.execute(input), 200);
  }
  async generateBackupCodes(input: GenerateBackupCodesInput): Promise<ControllerResponse> {
    return present(await this.deps.generateBackupCodes.execute(input), 200);
  }
  async revokeMfa(input: RevokeMfaInput): Promise<ControllerResponse> {
    return present(await this.deps.revokeMfa.execute(input), 200);
  }
  async decideMfa(input: DecideMfaInput): Promise<ControllerResponse> {
    return present(await this.deps.decideMfa.execute(input), 200);
  }
  async evaluateRisk(input: EvaluateRiskInput): Promise<ControllerResponse> {
    return present(await this.deps.evaluateRisk.execute(input), 200);
  }
  async revokeAllSessions(input: RevokeAllSessionsInput): Promise<ControllerResponse> {
    return present(await this.deps.revokeAllSessions.execute(input), 200);
  }

  // ── Secret rotation + machine identity + ABAC/ReBAC (P2.0-C) ───────────────
  async scheduleCredentialRotation(
    input: ScheduleCredentialRotationInput,
  ): Promise<ControllerResponse> {
    return present(await this.deps.scheduleCredentialRotation.execute(input), 200);
  }
  async rotateDueCredentials(input: RotateDueCredentialsInput): Promise<ControllerResponse> {
    return present(await this.deps.rotateDueCredentials.execute(input), 200);
  }
  async emergencyRevokeCredentials(
    input: EmergencyRevokeCredentialsInput,
  ): Promise<ControllerResponse> {
    return present(await this.deps.emergencyRevokeCredentials.execute(input), 200);
  }
  async getCredentialLineage(input: CredentialLineageInput): Promise<ControllerResponse> {
    return present(await this.deps.getCredentialLineage.execute(input), 200);
  }
  async governMachineIdentity(input: GovernMachineIdentityInput): Promise<ControllerResponse> {
    return present(await this.deps.governMachineIdentity.execute(input), 200);
  }
  async suspendMachineIdentity(input: SuspendMachineIdentityInput): Promise<ControllerResponse> {
    return present(await this.deps.suspendMachineIdentity.execute(input), 200);
  }
  async writeRelationTuple(input: RelationTupleInput): Promise<ControllerResponse> {
    return present(await this.deps.writeRelationTuple.execute(input), 201);
  }
  async deleteRelationTuple(input: RelationTupleInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteRelationTuple.execute(input), 200);
  }
  async checkAccess(input: CheckAccessInput): Promise<ControllerResponse> {
    return present(await this.deps.checkAccess.execute(input), 200);
  }
  /** Reads the latest projected consent decision (H-2) — Identity owns consent; Security only references it. */
  async checkConsent(input: CheckConsentInput): Promise<ControllerResponse> {
    return present(await this.deps.checkConsent.execute(input), 200);
  }
  /** Resolves a Kratos/Identity subject → Security principal + projected Identity user + memberships (H-2). */
  async resolvePrincipal(input: ResolvePrincipalInput): Promise<ControllerResponse> {
    return present(await this.deps.resolvePrincipal.execute(input), 200);
  }
  /** Resolves the organizations + roles a user belongs to, from the Identity membership projection (H-2). */
  async resolveMembership(input: ResolveMembershipInput): Promise<ControllerResponse> {
    return present(await this.deps.resolveMembership.execute(input), 200);
  }
  /** Resolves an organization from the Identity organization projection (H-2). */
  async resolveOrganization(input: ResolveOrganizationInput): Promise<ControllerResponse> {
    return present(await this.deps.resolveOrganization.execute(input), 200);
  }
  /** Resolves a Security-owned machine identity's governance profile (H-2). */
  async resolveMachineIdentity(input: ResolveMachineIdentityInput): Promise<ControllerResponse> {
    return present(await this.deps.resolveMachineIdentity.execute(input), 200);
  }

  // ── Policy language + security registry + compliance (P2.0-D) ──────────────
  async registerPolicyFragment(input: RegisterPolicyFragmentInput): Promise<ControllerResponse> {
    return present(await this.deps.registerPolicyFragment.execute(input), 201);
  }
  async registerMfaMethod(input: RegisterMfaMethodInput): Promise<ControllerResponse> {
    return present(await this.deps.registerMfaMethod.execute(input), 201);
  }
  async registerPermission(input: RegisterPermissionInput): Promise<ControllerResponse> {
    return present(await this.deps.registerPermission.execute(input), 201);
  }
  async registerComplianceRule(input: RegisterComplianceRuleInput): Promise<ControllerResponse> {
    return present(await this.deps.registerComplianceRule.execute(input), 201);
  }
  async evaluateCompliance(input: EvaluateComplianceInput): Promise<ControllerResponse> {
    return present(await this.deps.evaluateCompliance.execute(input), 200);
  }

  // ── Incidents + threat intelligence (P2.0-E) ──────────────────────────────
  async openIncident(input: OpenIncidentInput): Promise<ControllerResponse> {
    return present(await this.deps.openIncident.execute(input), 201);
  }
  async triageIncident(input: TriageIncidentInput): Promise<ControllerResponse> {
    return present(await this.deps.triageIncident.execute(input), 200);
  }
  async mitigateIncident(input: IncidentNoteInput): Promise<ControllerResponse> {
    return present(await this.deps.mitigateIncident.execute(input), 200);
  }
  async resolveIncident(input: ResolveIncidentInput): Promise<ControllerResponse> {
    return present(await this.deps.resolveIncident.execute(input), 200);
  }
  async closeIncident(input: IncidentNoteInput): Promise<ControllerResponse> {
    return present(await this.deps.closeIncident.execute(input), 200);
  }
  async addIncidentEvidence(input: AddIncidentEvidenceInput): Promise<ControllerResponse> {
    return present(await this.deps.addIncidentEvidence.execute(input), 200);
  }
  async checkThreatIndicator(input: CheckThreatIndicatorInput): Promise<ControllerResponse> {
    return present(await this.deps.checkThreatIndicator.execute(input), 200);
  }

  // ── AI security governance (P2.0-F §20) ───────────────────────────────────
  async governAiIdentity(input: GovernAiIdentityInput): Promise<ControllerResponse> {
    return present(await this.deps.governAiIdentity.execute(input), 200);
  }
  async suspendAiIdentity(input: SuspendAiIdentityInput): Promise<ControllerResponse> {
    return present(await this.deps.suspendAiIdentity.execute(input), 200);
  }
  async checkAiAction(input: CheckAiActionInput): Promise<ControllerResponse> {
    return present(await this.deps.checkAiAction.execute(input), 200);
  }

  // ── Console read models (Part 10) ─────────────────────────────────────────
  async identityOverview(tenantId: string): Promise<IdentityOverview> {
    return this.deps.readModels.identityOverview(tenantId);
  }
  /** T10.6: the STORED state of a tenant's baseline, for provisioning's completeness report. */
  async tenantBaseline(tenantId: string, ownerExternalId?: string): Promise<TenantBaselineState> {
    return this.deps.readModels.tenantBaseline(tenantId, ownerExternalId);
  }
  async permissionExplorer(tenantId: string): Promise<PermissionExplorer> {
    return this.deps.readModels.permissionExplorer(tenantId);
  }
  async auditExplorer(tenantId: string, tenantRef: string | null = null): Promise<AuditExplorer> {
    return this.deps.readModels.auditExplorer(tenantId, tenantRef);
  }
  async securityDashboard(
    tenantId: string,
    tenantRef: string | null = null,
  ): Promise<SecurityDashboard> {
    return this.deps.readModels.securityDashboard(tenantId, tenantRef);
  }
  async deviceExplorer(tenantId: string): Promise<DeviceExplorer> {
    return this.deps.readModels.deviceExplorer(tenantId);
  }
  async machineIdentityExplorer(tenantId: string): Promise<MachineIdentityExplorer> {
    return this.deps.readModels.machineIdentityExplorer(tenantId);
  }
  registryExplorer(): SecurityRegistryExplorer {
    return this.deps.readModels.registryExplorer();
  }
  async incidentExplorer(tenantId: string): Promise<IncidentExplorer> {
    return this.deps.readModels.incidentExplorer(tenantId);
  }
  async trustCenter(tenantId: string, tenantRef: string | null = null): Promise<TrustCenter> {
    return this.deps.readModels.trustCenter(tenantId, tenantRef);
  }
  securityAnalytics(): SecurityAnalytics {
    return this.deps.readModels.securityAnalytics();
  }
  async sessionExplorer(tenantId: string): Promise<SessionExplorer> {
    return this.deps.readModels.sessionExplorer(tenantId);
  }
  async policyExplorer(tenantId: string): Promise<PolicyExplorer> {
    return this.deps.readModels.policyExplorer(tenantId);
  }
  riskExplorer(): RiskExplorer {
    return this.deps.readModels.riskExplorer();
  }
  async secretExplorer(tenantId: string): Promise<SecretExplorer> {
    return this.deps.readModels.secretExplorer(tenantId);
  }
  async aiGovernanceExplorer(tenantId: string): Promise<AiGovernanceExplorer> {
    return this.deps.readModels.aiGovernanceExplorer(tenantId);
  }
}
