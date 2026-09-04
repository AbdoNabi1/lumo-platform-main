import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";
// Imported for local use as well as re-exported below: `export ... from` re-exports a name without
// binding it in this module's scope, and `transitionPrincipal`'s signature annotates with it.
import type { PrincipalTransitionTarget } from "./security-transitions";

/**
 * The Security Console (T3.1) — one fetch function per GET endpoint across the six
 * `apps/admin/src/http/security-*-routes.ts` route files, grouped exactly as the seven `/security`
 * screens group them (see `docs/plans/.progress/task-T3.1-brief.md`). Every DTO here is hand-typed
 * to the primitive fields the matching `services/security/src/interfaces/read-models.ts` /
 * `*.use-cases.ts` return — never the raw controller response cast through (README.md rule #2).
 *
 * T5.12 adds the write routes on top of the same file, one domain section at a time (T5.12a: AI
 * Governance). Each write section groups its typed `mutateAdminApi` functions right after the GET
 * section it extends, same file-organization the read side already uses.
 *
 * Every `console/*` route accepts the same optional `tenantRef` querystring
 * (`security-operations-routes.ts:50`) and passes `query.tenantRef ?? null` through; only
 * `dashboard`, `trust-center`, and `audit-explorer` actually use it (`read-models.ts`). This module
 * still only appends `?tenantRef=` for the endpoints whose read model takes the parameter — the
 * others ignore it server-side, so sending it would be misleading noise on the request.
 */

// ── Overview: dashboard, trust-center, analytics ────────────────────────────────────────────────

export interface SecurityDashboardDto {
  readonly metrics: Readonly<Record<string, number>>;
  readonly auditRecords: number;
  readonly chainValid: boolean;
}

function isSecurityDashboardDto(value: unknown): value is SecurityDashboardDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { auditRecords?: unknown }).auditRecords === "number" &&
    typeof (value as { chainValid?: unknown }).chainValid === "boolean"
  );
}

export type FetchSecurityDashboardResult =
  | { readonly outcome: "ok"; readonly data: SecurityDashboardDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/dashboard` — `security:security_dashboard`. */
export async function fetchSecurityDashboard(
  tenantRef?: string,
): Promise<FetchSecurityDashboardResult> {
  const params = new URLSearchParams();
  if (tenantRef !== undefined && tenantRef.length > 0) params.set("tenantRef", tenantRef);
  const result = await getAdminApi(
    `/api/v1/security/console/dashboard?${params.toString()}`,
    isSecurityDashboardDto,
  );
  return toSimpleResult(result);
}

export interface TrustCenterDto {
  readonly postureScore: number;
  readonly auditChainValid: boolean;
  readonly auditRecords: number;
  readonly openIncidents: number;
  readonly criticalIncidents: number;
  readonly complianceControls: number;
  readonly frameworks: readonly string[];
}

function isTrustCenterDto(value: unknown): value is TrustCenterDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { postureScore?: unknown }).postureScore === "number" &&
    Array.isArray((value as { frameworks?: unknown }).frameworks)
  );
}

export type FetchTrustCenterResult =
  | { readonly outcome: "ok"; readonly data: TrustCenterDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/trust-center` — `security:trust_center`. */
export async function fetchTrustCenter(tenantRef?: string): Promise<FetchTrustCenterResult> {
  const params = new URLSearchParams();
  if (tenantRef !== undefined && tenantRef.length > 0) params.set("tenantRef", tenantRef);
  const result = await getAdminApi(
    `/api/v1/security/console/trust-center?${params.toString()}`,
    isTrustCenterDto,
  );
  return toSimpleResult(result);
}

export interface SecurityAnalyticsDto {
  readonly loginSuccess: number;
  readonly loginFailure: number;
  readonly mfaSuccess: number;
  readonly mfaFailure: number;
  readonly accessAllowed: number;
  readonly accessDenied: number;
  readonly accessChallenged: number;
  readonly tokenRefreshed: number;
  readonly threatsIndicated: number;
  readonly sessionsRevoked: number;
  readonly riskDistribution: Readonly<Record<string, number>>;
}

function isSecurityAnalyticsDto(value: unknown): value is SecurityAnalyticsDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { loginSuccess?: unknown }).loginSuccess === "number" &&
    typeof (value as { riskDistribution?: unknown }).riskDistribution === "object"
  );
}

export type FetchSecurityAnalyticsResult =
  | { readonly outcome: "ok"; readonly data: SecurityAnalyticsDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/analytics` — `security:security_analytics`. No querystring. */
export async function fetchSecurityAnalytics(): Promise<FetchSecurityAnalyticsResult> {
  const result = await getAdminApi(
    `/api/v1/security/console/analytics`,
    isSecurityAnalyticsDto,
  );
  return toSimpleResult(result);
}

// ── Identity: identity-overview, machine-identity-explorer, + resolve/consent lookups ──────────

export interface PrincipalOverviewRowDto {
  readonly externalId: string;
  readonly kind: string;
  readonly status: string;
  readonly tenantRef: string | null;
  readonly human: boolean;
}
export interface IdentityOverviewDto {
  readonly total: number;
  readonly humans: number;
  readonly nonHumans: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly principals: readonly PrincipalOverviewRowDto[];
}

function isIdentityOverviewDto(value: unknown): value is IdentityOverviewDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { total?: unknown }).total === "number" &&
    Array.isArray((value as { principals?: unknown }).principals)
  );
}

export type FetchIdentityOverviewResult =
  | { readonly outcome: "ok"; readonly data: IdentityOverviewDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/identity-overview` — `security:identity_overview`. */
export async function fetchIdentityOverview(): Promise<FetchIdentityOverviewResult> {
  const result = await getAdminApi(
    `/api/v1/security/console/identity-overview`,
    isIdentityOverviewDto,
  );
  return toSimpleResult(result);
}

export interface MachineIdentityRowDto {
  readonly principalRef: string;
  readonly owner: string;
  readonly purpose: string;
  readonly status: string;
  readonly allowedScopeCount: number;
  readonly rotationIntervalDays: number | null;
}
export interface MachineIdentityExplorerDto {
  readonly total: number;
  readonly active: number;
  readonly suspended: number;
  readonly identities: readonly MachineIdentityRowDto[];
}

function isMachineIdentityExplorerDto(value: unknown): value is MachineIdentityExplorerDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { total?: unknown }).total === "number" &&
    Array.isArray((value as { identities?: unknown }).identities)
  );
}

export type FetchMachineIdentityExplorerResult =
  | { readonly outcome: "ok"; readonly data: MachineIdentityExplorerDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/machine-identity-explorer` — `security:machine_identity_explorer`. */
export async function fetchMachineIdentityExplorer(): Promise<FetchMachineIdentityExplorerResult> {
  const result = await getAdminApi(
    `/api/v1/security/console/machine-identity-explorer`,
    isMachineIdentityExplorerDto,
  );
  return toSimpleResult(result);
}

export interface ResolvedMembershipDto {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly role: string;
  readonly organizationSlug: string | null;
}
export interface ResolvedPrincipalDto {
  readonly principal: {
    readonly id: string;
    readonly externalId: string;
    readonly kind: string;
    readonly status: string;
    readonly tenantRef: string | null;
  } | null;
  readonly identityUser: {
    readonly userId: string;
    readonly status: string;
    readonly userTenant: string | null;
  } | null;
  readonly memberships: readonly ResolvedMembershipDto[];
}

function isResolvedPrincipalDto(value: unknown): value is ResolvedPrincipalDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { memberships?: unknown }).memberships)
  );
}

export type ResolvePrincipalResult =
  | { readonly outcome: "ok"; readonly data: ResolvedPrincipalDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/resolve/principals/:subjectRef` — `security:resolve_principal`. Lookup route. */
export async function resolvePrincipal(subjectRef: string): Promise<ResolvePrincipalResult> {
  const result = await getAdminApi(
    `/api/v1/security/resolve/principals/${encodeURIComponent(subjectRef)}`,
    isResolvedPrincipalDto,
  );
  return toSimpleResult(result);
}

export interface MembershipResolutionDto {
  readonly userId: string;
  readonly memberships: readonly ResolvedMembershipDto[];
}

function isMembershipResolutionDto(value: unknown): value is MembershipResolutionDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { userId?: unknown }).userId === "string" &&
    Array.isArray((value as { memberships?: unknown }).memberships)
  );
}

export type ResolveMembershipResult =
  | { readonly outcome: "ok"; readonly data: MembershipResolutionDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/resolve/memberships/:userId` — `security:resolve_membership`. Lookup route. */
export async function resolveMembership(userId: string): Promise<ResolveMembershipResult> {
  const result = await getAdminApi(
    `/api/v1/security/resolve/memberships/${encodeURIComponent(userId)}`,
    isMembershipResolutionDto,
  );
  return toSimpleResult(result);
}

export interface OrganizationResolutionDto {
  readonly organizationId: string;
  readonly slug: string;
  readonly tenant: string | null;
}

function isOrganizationResolutionDto(value: unknown): value is OrganizationResolutionDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { organizationId?: unknown }).organizationId === "string" &&
    typeof (value as { slug?: unknown }).slug === "string"
  );
}

export type ResolveOrganizationResult =
  | { readonly outcome: "ok"; readonly data: OrganizationResolutionDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /security/resolve/organizations/:organizationId` — `security:resolve_organization`. Lookup
 * route. Can 404 (`resolution.use-cases.ts`'s `ResolveOrganization` — absent from the projection).
 */
export async function resolveOrganization(
  organizationId: string,
): Promise<ResolveOrganizationResult> {
  const result = await getAdminApi(
    `/api/v1/security/resolve/organizations/${encodeURIComponent(organizationId)}`,
    isOrganizationResolutionDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", data: result.data };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  if (result.outcome === "not_found") return { outcome: "not_found" };
  return { outcome: "error", message: result.message };
}

export interface MachineIdentityResolutionDto {
  readonly principalRef: string;
  readonly owner: string;
  readonly purpose: string;
  readonly status: string;
  readonly allowedScopes: readonly string[];
  readonly allowedEnvironments: readonly string[];
}

function isMachineIdentityResolutionDto(value: unknown): value is MachineIdentityResolutionDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { principalRef?: unknown }).principalRef === "string" &&
    Array.isArray((value as { allowedScopes?: unknown }).allowedScopes)
  );
}

export type ResolveMachineIdentityResult =
  | { readonly outcome: "ok"; readonly data: MachineIdentityResolutionDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /security/resolve/machine-identities/:externalId` — `security:resolve_machine_identity`.
 * Lookup route. Can 404 (principal not found, or found but not governed).
 */
export async function resolveMachineIdentity(
  externalId: string,
): Promise<ResolveMachineIdentityResult> {
  const result = await getAdminApi(
    `/api/v1/security/resolve/machine-identities/${encodeURIComponent(externalId)}`,
    isMachineIdentityResolutionDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", data: result.data };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  if (result.outcome === "not_found") return { outcome: "not_found" };
  return { outcome: "error", message: result.message };
}

export interface ConsentDecisionDto {
  readonly subjectRef: string;
  readonly purpose: string;
  readonly granted: boolean;
}

function isConsentDecisionDto(value: unknown): value is ConsentDecisionDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { subjectRef?: unknown }).subjectRef === "string" &&
    typeof (value as { granted?: unknown }).granted === "boolean"
  );
}

export type CheckConsentResult =
  | { readonly outcome: "ok"; readonly data: ConsentDecisionDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/consent/:subjectRef?purpose=` — `security:check_consent`. Lookup route; fail-closed. */
export async function checkConsent(
  subjectRef: string,
  purpose: string,
): Promise<CheckConsentResult> {
  const params = new URLSearchParams({ purpose });
  const result = await getAdminApi(
    `/api/v1/security/consent/${encodeURIComponent(subjectRef)}?${params.toString()}`,
    isConsentDecisionDto,
  );
  return toSimpleResult(result);
}

// ── Access: permission-explorer, policy-explorer, registry-explorer ────────────────────────────

export interface RoleSummaryRowDto {
  readonly key: string;
  readonly name: string;
  readonly permissionCount: number;
  readonly parentKey: string | null;
  readonly isTemplate: boolean;
  readonly status: string;
  readonly scope: string;
}
export interface PolicySummaryRowDto {
  readonly key: string;
  readonly mode: string;
  readonly status: string;
  readonly activeVersion: number | null;
}
export interface PermissionExplorerDto {
  readonly roles: readonly RoleSummaryRowDto[];
  readonly policies: readonly PolicySummaryRowDto[];
}

function isPermissionExplorerDto(value: unknown): value is PermissionExplorerDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { roles?: unknown }).roles) &&
    Array.isArray((value as { policies?: unknown }).policies)
  );
}

export type FetchPermissionExplorerResult =
  | { readonly outcome: "ok"; readonly data: PermissionExplorerDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/permission-explorer` — `security:permission_explorer`. */
export async function fetchPermissionExplorer(): Promise<FetchPermissionExplorerResult> {
  const result = await getAdminApi(
    `/api/v1/security/console/permission-explorer`,
    isPermissionExplorerDto,
  );
  return toSimpleResult(result);
}

export interface PolicyExplorerRowDto {
  readonly key: string;
  readonly mode: string;
  readonly status: string;
  readonly activeVersion: number | null;
  readonly versionCount: number;
}
export interface PolicyExplorerDto {
  readonly policies: readonly PolicyExplorerRowDto[];
  readonly fragments: readonly { readonly key: string; readonly version: number }[];
}

function isPolicyExplorerDto(value: unknown): value is PolicyExplorerDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { policies?: unknown }).policies) &&
    Array.isArray((value as { fragments?: unknown }).fragments)
  );
}

export type FetchPolicyExplorerResult =
  | { readonly outcome: "ok"; readonly data: PolicyExplorerDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/policy-explorer` — `security:policy_explorer`. */
export async function fetchPolicyExplorer(): Promise<FetchPolicyExplorerResult> {
  const result = await getAdminApi(`/api/v1/security/console/policy-explorer`, isPolicyExplorerDto);
  return toSimpleResult(result);
}

export interface RegistrySummaryRowDto {
  readonly name: string;
  readonly entryCount: number;
  readonly entries: readonly {
    readonly key: string;
    readonly version: number;
    readonly status: string;
  }[];
}
export interface SecurityRegistryExplorerDto {
  readonly totalEntries: number;
  readonly registries: readonly RegistrySummaryRowDto[];
}

function isSecurityRegistryExplorerDto(value: unknown): value is SecurityRegistryExplorerDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { totalEntries?: unknown }).totalEntries === "number" &&
    Array.isArray((value as { registries?: unknown }).registries)
  );
}

export type FetchRegistryExplorerResult =
  | { readonly outcome: "ok"; readonly data: SecurityRegistryExplorerDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/registry-explorer` — `security:registry_explorer`. */
export async function fetchRegistryExplorer(): Promise<FetchRegistryExplorerResult> {
  const result = await getAdminApi(
    `/api/v1/security/console/registry-explorer`,
    isSecurityRegistryExplorerDto,
  );
  return toSimpleResult(result);
}

// ── Sessions: session-explorer, device-explorer, risk-explorer, + introspect lookup ────────────

export interface SessionRowDto {
  readonly id: string;
  readonly principalRef: string;
  readonly status: string;
  readonly externalRef: string | null;
  readonly refreshCount: number;
  readonly riskAtLastEval: number;
  readonly impersonatedBy: string | null;
  readonly suspicious: boolean;
  readonly expiresAt: string;
}
export interface SessionExplorerDto {
  readonly total: number;
  readonly active: number;
  readonly revoked: number;
  readonly expired: number;
  readonly impersonations: number;
  readonly suspicious: number;
  readonly sessions: readonly SessionRowDto[];
}

function isSessionExplorerDto(value: unknown): value is SessionExplorerDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { total?: unknown }).total === "number" &&
    Array.isArray((value as { sessions?: unknown }).sessions)
  );
}

export type FetchSessionExplorerResult =
  | { readonly outcome: "ok"; readonly data: SessionExplorerDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/session-explorer` — `security:session_explorer`. */
export async function fetchSessionExplorer(): Promise<FetchSessionExplorerResult> {
  const result = await getAdminApi(
    `/api/v1/security/console/session-explorer`,
    isSessionExplorerDto,
  );
  return toSimpleResult(result);
}

export interface DeviceExplorerRowDto {
  readonly fingerprint: string;
  readonly principalRef: string | null;
  readonly trustLevel: string;
  readonly reputation: number;
  readonly anomalyCount: number;
  readonly lastSeenAt: string;
}
export interface DeviceExplorerDto {
  readonly total: number;
  readonly trusted: number;
  readonly blocked: number;
  readonly devices: readonly DeviceExplorerRowDto[];
}

function isDeviceExplorerDto(value: unknown): value is DeviceExplorerDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { total?: unknown }).total === "number" &&
    Array.isArray((value as { devices?: unknown }).devices)
  );
}

export type FetchDeviceExplorerResult =
  | { readonly outcome: "ok"; readonly data: DeviceExplorerDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/device-explorer` — `security:device_explorer`. */
export async function fetchDeviceExplorer(): Promise<FetchDeviceExplorerResult> {
  const result = await getAdminApi(`/api/v1/security/console/device-explorer`, isDeviceExplorerDto);
  return toSimpleResult(result);
}

export interface RiskExplorerDto {
  readonly distribution: Readonly<Record<string, number>>;
  readonly total: number;
  readonly dominantBand: string | null;
  readonly threatsIndicated: number;
}

function isRiskExplorerDto(value: unknown): value is RiskExplorerDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { total?: unknown }).total === "number" &&
    typeof (value as { distribution?: unknown }).distribution === "object"
  );
}

export type FetchRiskExplorerResult =
  | { readonly outcome: "ok"; readonly data: RiskExplorerDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/risk-explorer` — `security:risk_explorer`. */
export async function fetchRiskExplorer(): Promise<FetchRiskExplorerResult> {
  const result = await getAdminApi(`/api/v1/security/console/risk-explorer`, isRiskExplorerDto);
  return toSimpleResult(result);
}

export interface SessionOutputDto {
  readonly id: string;
  readonly principalRef: string;
  readonly status: string;
  readonly externalRef: string | null;
  readonly refreshCount: number;
  readonly impersonatedBy: string | null;
  readonly expiresAt: string;
}
export interface SessionIntrospectionDto {
  readonly active: boolean;
  readonly session: SessionOutputDto | null;
}

function isSessionIntrospectionDto(value: unknown): value is SessionIntrospectionDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { active?: unknown }).active === "boolean"
  );
}

export type IntrospectSessionResult =
  | { readonly outcome: "ok"; readonly data: SessionIntrospectionDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /security/sessions/:sessionId/introspect` — `security:introspect_session`. Lookup route;
 * a missing session comes back as an `ok` result with `active: false, session: null`, never a 404
 * (`session.use-cases.ts`'s `IntrospectSession`).
 */
export async function introspectSession(sessionId: string): Promise<IntrospectSessionResult> {
  const result = await getAdminApi(
    `/api/v1/security/sessions/${encodeURIComponent(sessionId)}/introspect`,
    isSessionIntrospectionDto,
  );
  return toSimpleResult(result);
}

// ── Audit: audit-explorer, incident-explorer, audit-chain/verify ───────────────────────────────

export interface AuditTimelineRowDto {
  readonly sequence: number;
  readonly principalRef: string;
  readonly action: string;
  readonly decision: string;
  readonly resource: string | null;
  readonly occurredAt: string;
  readonly hash: string;
}
export interface AuditExplorerDto {
  readonly count: number;
  readonly chainValid: boolean;
  readonly brokenAt?: number;
  readonly timeline: readonly AuditTimelineRowDto[];
}

function isAuditExplorerDto(value: unknown): value is AuditExplorerDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { count?: unknown }).count === "number" &&
    Array.isArray((value as { timeline?: unknown }).timeline)
  );
}

export type FetchAuditExplorerResult =
  | { readonly outcome: "ok"; readonly data: AuditExplorerDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/audit-explorer` — `security:audit_explorer`. */
export async function fetchAuditExplorer(tenantRef?: string): Promise<FetchAuditExplorerResult> {
  const params = new URLSearchParams();
  if (tenantRef !== undefined && tenantRef.length > 0) params.set("tenantRef", tenantRef);
  const result = await getAdminApi(
    `/api/v1/security/console/audit-explorer?${params.toString()}`,
    isAuditExplorerDto,
  );
  return toSimpleResult(result);
}

export interface IncidentRowDto {
  readonly reference: string;
  readonly title: string;
  readonly severity: string;
  readonly status: string;
  readonly category: string;
  readonly assignee: string | null;
}
export interface IncidentExplorerDto {
  readonly total: number;
  readonly open: number;
  readonly bySeverity: Readonly<Record<string, number>>;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly incidents: readonly IncidentRowDto[];
}

function isIncidentExplorerDto(value: unknown): value is IncidentExplorerDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { total?: unknown }).total === "number" &&
    Array.isArray((value as { incidents?: unknown }).incidents)
  );
}

export type FetchIncidentExplorerResult =
  | { readonly outcome: "ok"; readonly data: IncidentExplorerDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/incident-explorer` — `security:incident_explorer`. */
export async function fetchIncidentExplorer(): Promise<FetchIncidentExplorerResult> {
  const result = await getAdminApi(
    `/api/v1/security/console/incident-explorer`,
    isIncidentExplorerDto,
  );
  return toSimpleResult(result);
}

export interface AuditChainReportDto {
  readonly valid: boolean;
  readonly count: number;
  readonly brokenAt?: number;
  readonly reason?: string;
}

function isAuditChainReportDto(value: unknown): value is AuditChainReportDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { valid?: unknown }).valid === "boolean" &&
    typeof (value as { count?: unknown }).count === "number"
  );
}

export type VerifyAuditChainResult =
  | { readonly outcome: "ok"; readonly data: AuditChainReportDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/audit-chain/verify` — `security:verify_audit_chain`. */
export async function verifyAuditChain(tenantRef?: string): Promise<VerifyAuditChainResult> {
  const params = new URLSearchParams();
  if (tenantRef !== undefined && tenantRef.length > 0) params.set("tenantRef", tenantRef);
  const result = await getAdminApi(
    `/api/v1/security/audit-chain/verify?${params.toString()}`,
    isAuditChainReportDto,
  );
  return toSimpleResult(result);
}

// ── Secrets: secret-explorer, + credential lineage lookup ──────────────────────────────────────

export interface SecretRowDto {
  readonly principalRef: string;
  readonly kind: string;
  readonly status: string;
  readonly rotationDueAt: string | null;
  readonly autoRotate: boolean;
}
export interface SecretExplorerDto {
  readonly total: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly rotationDue: number;
  readonly credentials: readonly SecretRowDto[];
}

function isSecretExplorerDto(value: unknown): value is SecretExplorerDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { total?: unknown }).total === "number" &&
    Array.isArray((value as { credentials?: unknown }).credentials)
  );
}

export type FetchSecretExplorerResult =
  | { readonly outcome: "ok"; readonly data: SecretExplorerDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/secret-explorer` — `security:secret_explorer`. Never exposes secret values. */
export async function fetchSecretExplorer(): Promise<FetchSecretExplorerResult> {
  const result = await getAdminApi(`/api/v1/security/console/secret-explorer`, isSecretExplorerDto);
  return toSimpleResult(result);
}

export interface CredentialOutputDto {
  readonly id: string;
  readonly principalRef: string;
  readonly kind: string;
  readonly status: string;
  readonly kmsKeyRef: string | null;
  readonly supersedesRef: string | null;
  readonly expiresAt: string | null;
  readonly rotationDueAt: string | null;
  readonly autoRotate: boolean;
}
export interface CredentialLineageDto {
  readonly chain: readonly CredentialOutputDto[];
}

function isCredentialLineageDto(value: unknown): value is CredentialLineageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { chain?: unknown }).chain)
  );
}

export type GetCredentialLineageResult =
  | { readonly outcome: "ok"; readonly data: CredentialLineageDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /security/credentials/:credentialId/lineage` — `security:get_credential_lineage`. Lookup
 * route; 404 when the credential doesn't exist (`credential.use-cases.ts`'s `GetCredentialLineage`).
 */
export async function getCredentialLineage(
  credentialId: string,
): Promise<GetCredentialLineageResult> {
  const result = await getAdminApi(
    `/api/v1/security/credentials/${encodeURIComponent(credentialId)}/lineage`,
    isCredentialLineageDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", data: result.data };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  if (result.outcome === "not_found") return { outcome: "not_found" };
  return { outcome: "error", message: result.message };
}

// ── Secrets/Credential writes: issue/rotate/revoke, schedule, rotate-due, emergency-revoke (T5.12c) ─
//
// T5.12c combines `security-identity-routes.ts`'s 3 credential-specific routes (issue/rotate/revoke
// — the principal/machine-identity routes in that same file are T5.12b's, already above) with all 3
// of `security-secrets-routes.ts`'s routes, because the task brief groups them as one risk category:
// "credential rotation". All 6 share `CredentialOutputDto` (already defined above for
// `getCredentialLineage`) or a small dedicated result DTO for the two bulk actions.

/** Mirrors `security-identity-routes.ts`'s `credentialKindEnum` field-for-field. */
export type CredentialKind = "api_key" | "secret" | "certificate" | "signing_key" | "oauth_client";

function isCredentialOutputDto(value: unknown): value is CredentialOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

export interface IssueCredentialInput {
  readonly principalExternalId: string;
  readonly kind: CredentialKind;
  /** A handle to the secret material — fingerprinted server-side, never persisted or echoed back. */
  readonly material: string;
  readonly expiresAt?: string | null;
}

/**
 * `POST /security/credentials` — `security:issue_credential`. `idempotent: true` on the backend,
 * though `IssueCredential.execute` (`services/security/src/application/credential.use-cases.ts`)
 * has no dedupe key of its own — a resubmit issues a second credential for the same principal, so
 * constraint #8's fresh `Idempotency-Key` per submit is what actually prevents a double-click from
 * minting two.
 */
export function issueCredential(
  input: IssueCredentialInput,
  idempotencyKey: string,
): Promise<MutationResult<CredentialOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/credentials`,
    { method: "POST", body: input, idempotencyKey },
    isCredentialOutputDto,
  );
}

/**
 * `POST /security/credentials/:credentialId/rotate` — `security:rotate_credential`. Marks the
 * credential passed in `rotated` and returns the *new superseding* credential
 * (`RotateCredential.execute`'s `present(replacement)`) — the `id` in the response is a different
 * credential from the one the caller passed in, with `supersedesRef` pointing back at it.
 */
export function rotateCredential(
  credentialId: string,
  newMaterial: string,
  idempotencyKey: string,
): Promise<MutationResult<CredentialOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/credentials/${encodeURIComponent(credentialId)}/rotate`,
    { method: "POST", body: { newMaterial }, idempotencyKey },
    isCredentialOutputDto,
  );
}

/**
 * `POST /security/credentials/:credentialId/revoke` — `security:revoke_credential`. No body.
 * Revokes immediately; irreversible from this screen (no "un-revoke" route exists).
 */
export function revokeCredential(
  credentialId: string,
  idempotencyKey: string,
): Promise<MutationResult<CredentialOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/credentials/${encodeURIComponent(credentialId)}/revoke`,
    { method: "POST", idempotencyKey },
    isCredentialOutputDto,
  );
}

export interface ScheduleCredentialRotationInput {
  readonly intervalDays: number;
  readonly graceSeconds: number;
  readonly autoRotate?: boolean;
}

/**
 * `POST /security/credentials/:credentialId/rotation-schedule` —
 * `security:schedule_credential_rotation`. Attaches a rotation policy (interval + grace + auto) to
 * a credential; `idempotent: true`.
 */
export function scheduleCredentialRotation(
  credentialId: string,
  input: ScheduleCredentialRotationInput,
  idempotencyKey: string,
): Promise<MutationResult<CredentialOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/credentials/${encodeURIComponent(credentialId)}/rotation-schedule`,
    { method: "POST", body: input, idempotencyKey },
    isCredentialOutputDto,
  );
}

export interface RotateDueCredentialsResultDto {
  readonly rotated: number;
}

function isRotateDueCredentialsResultDto(value: unknown): value is RotateDueCredentialsResultDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { rotated?: unknown }).rotated === "number"
  );
}

/**
 * `POST /security/credentials/rotate-due` — `security:rotate_due_credentials`. **Not** `idempotent`
 * on the backend (route table) — a bulk, scheduler-shaped action ("rotate every credential whose
 * scheduled rotation is due"). Constraint #8 still mints a fresh `Idempotency-Key` per submit, and
 * constraint #10 requires confirming before submit since a resubmit isn't the guaranteed no-op the
 * `idempotent: true` routes above are.
 */
export function rotateDueCredentials(
  idempotencyKey: string,
): Promise<MutationResult<RotateDueCredentialsResultDto>> {
  return mutateAdminApi(
    `/api/v1/security/credentials/rotate-due`,
    { method: "POST", idempotencyKey },
    isRotateDueCredentialsResultDto,
  );
}

export interface EmergencyRevokeCredentialsInput {
  readonly principalExternalId: string;
  readonly reason: string;
}

export interface EmergencyRevokeResultDto {
  readonly revoked: number;
}

function isEmergencyRevokeResultDto(value: unknown): value is EmergencyRevokeResultDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { revoked?: unknown }).revoked === "number"
  );
}

/**
 * `POST /security/credentials/emergency-revoke` — `security:emergency_revoke_credentials`. **Not**
 * `idempotent` on the backend — the plan's named "credential rotation" high-blast-radius category's
 * single highest-blast-radius action: "revoke every non-terminal credential for a principal at once
 * (breach response)" (`EmergencyRevokeCredentials.execute`). The UI confirms this one with an
 * explicit dialog naming the exact principal and stating the action is irreversible and affects
 * every credential that principal holds (constraint #10) — not the generic confirm text every other
 * destructive control in this module uses.
 */
export function emergencyRevokeCredentials(
  input: EmergencyRevokeCredentialsInput,
  idempotencyKey: string,
): Promise<MutationResult<EmergencyRevokeResultDto>> {
  return mutateAdminApi(
    `/api/v1/security/credentials/emergency-revoke`,
    { method: "POST", body: input, idempotencyKey },
    isEmergencyRevokeResultDto,
  );
}

// ── AI Governance: ai-governance-explorer ───────────────────────────────────────────────────────

export interface AiGovernanceRowDto {
  readonly principalRef: string;
  readonly status: string;
  readonly tokenBudget: number | null;
  readonly tokensConsumed: number;
  readonly callQuota: number | null;
  readonly callsConsumed: number;
  readonly isolationLevel: string;
}
export interface AiGovernanceExplorerDto {
  readonly total: number;
  readonly active: number;
  readonly suspended: number;
  readonly identities: readonly AiGovernanceRowDto[];
}

function isAiGovernanceExplorerDto(value: unknown): value is AiGovernanceExplorerDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { total?: unknown }).total === "number" &&
    Array.isArray((value as { identities?: unknown }).identities)
  );
}

export type FetchAiGovernanceExplorerResult =
  | { readonly outcome: "ok"; readonly data: AiGovernanceExplorerDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /security/console/ai-governance-explorer` — `security:ai_governance_explorer`. */
export async function fetchAiGovernanceExplorer(): Promise<FetchAiGovernanceExplorerResult> {
  const result = await getAdminApi(
    `/api/v1/security/console/ai-governance-explorer`,
    isAiGovernanceExplorerDto,
  );
  return toSimpleResult(result);
}

// ── AI Governance writes: govern/suspend/check-action (T5.12a) ─────────────────────────────────

/**
 * The `AiGovernanceOutput` DTO both `governAiIdentity` and `suspendAiIdentity` return
 * (`services/security/src/application/ai-governance.use-cases.ts`'s `present()`) — a plain DTO,
 * not the `AiGovernanceProfile` aggregate, so it's safe to type in full (README.md rule #2).
 */
export interface AiGovernanceProfileDto {
  readonly principalRef: string;
  readonly status: string;
  readonly tokenBudget: number | null;
  readonly callQuota: number | null;
  readonly tokensConsumed: number;
  readonly callsConsumed: number;
  readonly isolationLevel: string;
  readonly allowedTools: readonly string[];
  readonly allowedResources: readonly string[];
}

function isAiGovernanceProfileDto(value: unknown): value is AiGovernanceProfileDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { principalRef?: unknown }).principalRef === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

export type AiIsolationLevel = "none" | "sandboxed" | "isolated";

/** Mirrors `security-ai-governance-routes.ts`'s `aiGovernanceConfigSchema` field-for-field. */
export interface GovernAiIdentityConfigInput {
  readonly tokenBudget?: number | null;
  readonly callQuota?: number | null;
  readonly windowSeconds?: number;
  readonly allowedTools?: readonly string[];
  readonly allowedResources?: readonly string[];
  readonly isolationLevel?: AiIsolationLevel;
}

/**
 * `POST /security/ai-identities/:externalId` — `security:govern_ai_identity`. `idempotent: true`
 * — an idempotent create-or-patch: the first call creates the governance profile, later calls
 * patch it (unspecified `config` fields are left untouched, per `AiGovernanceProfile.reconfigure`).
 */
export function governAiIdentity(
  externalId: string,
  config: GovernAiIdentityConfigInput,
  idempotencyKey: string,
): Promise<MutationResult<AiGovernanceProfileDto>> {
  return mutateAdminApi(
    `/api/v1/security/ai-identities/${encodeURIComponent(externalId)}`,
    { method: "POST", body: { config }, idempotencyKey },
    isAiGovernanceProfileDto,
  );
}

/**
 * `POST /security/ai-identities/:externalId/suspend` — `security:suspend_ai_identity`. The
 * kill-switch: no body. `idempotent: true` on the backend, but constraint #8 (every Phase 5 task)
 * still mints a fresh `Idempotency-Key` per submit here, same as every other write in this file.
 */
export function suspendAiIdentity(
  externalId: string,
  idempotencyKey: string,
): Promise<MutationResult<AiGovernanceProfileDto>> {
  return mutateAdminApi(
    `/api/v1/security/ai-identities/${encodeURIComponent(externalId)}/suspend`,
    { method: "POST", idempotencyKey },
    isAiGovernanceProfileDto,
  );
}

/**
 * The `AiActionDecision` DTO `checkAiAction` returns
 * (`services/security/src/application/ai-governance.use-cases.ts`) — also a plain DTO.
 */
export interface AiActionDecisionDto {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly remainingTokens: number | null;
  readonly remainingCalls: number | null;
}

function isAiActionDecisionDto(value: unknown): value is AiActionDecisionDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { allowed?: unknown }).allowed === "boolean"
  );
}

export interface CheckAiActionInput {
  readonly tool?: string;
  readonly resource?: string;
  readonly tokens?: number;
  readonly calls?: number;
}

/**
 * `POST /security/ai-identities/:externalId/actions/check` — `security:check_ai_action`. **Not**
 * `idempotent` on the backend (route table) — per the task brief this is the AI action gate's
 * simulation/check tool ("checks sandboxing, isolation, and budget/quota in one call"), not a
 * mutation whose lasting effect a form should treat like a create. Callers still resolve a fresh
 * `Idempotency-Key` per submit (constraint #8) even though this route ignores it.
 */
export function checkAiAction(
  externalId: string,
  input: CheckAiActionInput,
  idempotencyKey: string,
): Promise<MutationResult<AiActionDecisionDto>> {
  return mutateAdminApi(
    `/api/v1/security/ai-identities/${encodeURIComponent(externalId)}/actions/check`,
    { method: "POST", body: input, idempotencyKey },
    isAiActionDecisionDto,
  );
}

// ── Identity writes: register/transition principal, govern/suspend machine identity (T5.12b) ───

/** Mirrors `security-identity-routes.ts`'s `principalKindEnum` field-for-field. */
export type PrincipalKind =
  | "human"
  | "service_account"
  | "machine"
  | "api_key"
  | "robot"
  | "partner"
  | "marketplace"
  | "ai";

/**
 * The `PrincipalOutput` DTO both `registerPrincipal` and `transitionPrincipal` return
 * (`services/security/src/application/principal.use-cases.ts`'s `presentPrincipal()`) — a plain
 * DTO, not the `Principal` aggregate, so it's safe to type in full (README.md rule #2).
 */
export interface PrincipalOutputDto {
  readonly id: string;
  readonly externalId: string;
  readonly kind: string;
  readonly status: string;
  readonly subjectRef?: string;
  readonly tenantRef?: string;
}

function isPrincipalOutputDto(value: unknown): value is PrincipalOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { externalId?: unknown }).externalId === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

export interface RegisterPrincipalInput {
  readonly externalId: string;
  readonly kind: PrincipalKind;
  readonly displayName: string;
  readonly subjectRef?: string | null;
  readonly tenantRef?: string | null;
  readonly attributes?: Readonly<Record<string, string>>;
}

/**
 * `POST /security/principals` — `security:register_principal`. `idempotent: true` per
 * `externalId`: `RegisterPrincipal.execute` returns the existing principal unchanged on a repeat
 * call with the same `externalId`, rather than erroring or duplicating it.
 */
export function registerPrincipal(
  input: RegisterPrincipalInput,
  idempotencyKey: string,
): Promise<MutationResult<PrincipalOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/principals`,
    { method: "POST", body: input, idempotencyKey },
    isPrincipalOutputDto,
  );
}

/**
 * Defined in `./security-transitions`, which holds the transition tables so that Client Components
 * can import them without pulling in this module's `./client` → `@/lib/auth/session` →
 * `next/headers` chain. Re-exported here so server-side callers are unaffected.
 */
export {
  PRINCIPAL_STATUS_TRANSITIONS,
  type PrincipalTransitionTarget,
} from "./security-transitions";

/**
 * `POST /security/principals/:externalId/transitions` — `security:transition_principal`.
 * Advances a principal's lifecycle (suspend/activate/disable). `idempotent: true`.
 */
export function transitionPrincipal(
  externalId: string,
  to: PrincipalTransitionTarget,
  idempotencyKey: string,
): Promise<MutationResult<PrincipalOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/principals/${encodeURIComponent(externalId)}/transitions`,
    { method: "POST", body: { to }, idempotencyKey },
    isPrincipalOutputDto,
  );
}

/**
 * The `MachineIdentityOutput` DTO both `governMachineIdentity` and `suspendMachineIdentity` return
 * (`services/security/src/application/machine-identity.use-cases.ts`'s `present()`) — a plain
 * DTO, not the `MachineIdentityProfile` aggregate (README.md rule #2). Note `principalRef` here is
 * the profile's *internal* principal id (`principal.id.toString()`, set at `governMachineIdentity`
 * call time), not the `externalId` these routes take as a path param — same distinction
 * `AiGovernanceRowDto.principalRef` already documents, and why the explorer's rows can't be used
 * to attach a per-row control to either of these two actions (see the standalone forms below).
 */
export interface MachineIdentityOutputDto {
  readonly principalRef: string;
  readonly owner: string;
  readonly purpose: string;
  readonly status: string;
  readonly allowedEnvironments: readonly string[];
  readonly allowedScopes: readonly string[];
  readonly maxCredentialTtlSeconds: number | null;
  readonly rotationIntervalDays: number | null;
}

function isMachineIdentityOutputDto(value: unknown): value is MachineIdentityOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { principalRef?: unknown }).principalRef === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

/** Mirrors `security-identity-routes.ts`'s `machineIdentityConfigSchema` field-for-field. */
export interface MachineIdentityConfigInput {
  readonly owner?: string;
  readonly purpose?: string;
  readonly allowedEnvironments?: readonly string[];
  readonly maxCredentialTtlSeconds?: number | null;
  readonly rotationIntervalDays?: number | null;
  readonly allowedScopes?: readonly string[];
}

/**
 * `POST /security/machine-identities/:externalId` — `security:govern_machine_identity`.
 * `idempotent: true` — an idempotent create-or-patch, same shape as `governAiIdentity`: the first
 * call creates the profile, later calls patch it (unspecified `config` fields left untouched).
 * Rejects human principals server-side (`GovernMachineIdentity.execute`) as a normal form error.
 */
export function governMachineIdentity(
  externalId: string,
  config: MachineIdentityConfigInput,
  idempotencyKey: string,
): Promise<MutationResult<MachineIdentityOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/machine-identities/${encodeURIComponent(externalId)}`,
    { method: "POST", body: { config }, idempotencyKey },
    isMachineIdentityOutputDto,
  );
}

/**
 * `POST /security/machine-identities/:externalId/suspend` — `security:suspend_machine_identity`.
 * The kill-switch: no body. `idempotent: true` on the backend, but constraint #8 still mints a
 * fresh `Idempotency-Key` per submit here, same as every other write in this file. 404s if the
 * principal has no governed machine-identity profile yet (`SuspendMachineIdentity.execute`).
 */
export function suspendMachineIdentity(
  externalId: string,
  idempotencyKey: string,
): Promise<MutationResult<MachineIdentityOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/machine-identities/${encodeURIComponent(externalId)}/suspend`,
    { method: "POST", idempotencyKey },
    isMachineIdentityOutputDto,
  );
}

// ── Operations writes: incident lifecycle, threat-indicator check, compliance evaluate/register (T5.12d) ─
//
// The plan's named "incident triage" high-blast-radius category — `security-operations-routes.ts`'s
// 9 routes, all delegating to `admin.securityOperations` (`services/security/src/interfaces/
// security.controller.ts`). `IncidentRowDto` (the incident-explorer read model, above) exposes both
// `reference` and `status` per row, so the 5 incident-lifecycle actions attach directly to each row
// (unlike `AiGovernanceRowDto`/`MachineIdentityRowDto`'s internal-id-only rows in T5.12a/b, which
// needed standalone forms) — verified against the actual DTO shape rather than assumed, same
// discipline those two parts' doc comments document for their own read models.

/** Mirrors `security-operations-routes.ts`'s `incidentSeverityEnum` field-for-field. */
export type IncidentSeverity = "low" | "medium" | "high" | "critical";

/**
 * The `IncidentOutput` DTO every incident-lifecycle write returns
 * (`services/security/src/application/incident.use-cases.ts`'s `present()`) — a plain DTO, not the
 * `Incident` aggregate (README.md rule #2). Same primitive fields `IncidentRowDto` already exposes
 * plus `id`/`timelineEntries`/`evidenceCount`.
 */
export interface IncidentOutputDto {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly severity: string;
  readonly status: string;
  readonly category: string;
  readonly assignee: string | null;
  readonly timelineEntries: number;
  readonly evidenceCount: number;
}

function isIncidentOutputDto(value: unknown): value is IncidentOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { reference?: unknown }).reference === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

export interface OpenIncidentInput {
  readonly title: string;
  readonly severity: IncidentSeverity;
  readonly category: string;
  readonly reference?: string;
  readonly tenantRef?: string | null;
}

/**
 * `POST /security/incidents` (open) — `security:open_incident`. `idempotent: true` per `reference`:
 * `OpenIncident.execute` returns the existing incident unchanged on a repeat call with the same
 * `reference` (caller-supplied, or server-generated as `INC-...` when omitted), rather than erroring
 * or duplicating it.
 */
export function openIncident(
  input: OpenIncidentInput,
  idempotencyKey: string,
): Promise<MutationResult<IncidentOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/incidents`,
    { method: "POST", body: input, idempotencyKey },
    isIncidentOutputDto,
  );
}

/**
 * Defined in `./security-transitions` for the same reason as `PRINCIPAL_STATUS_TRANSITIONS` above:
 * `audit-actions.tsx` is a Client Component and imports it as a value.
 */
export { INCIDENT_NEXT_ACTIONS, type IncidentLifecycleAction } from "./security-transitions";

/**
 * `POST /security/incidents/:reference/triage` — `security:triage_incident`. Assigns an owner.
 * `idempotent: true`. This is literally "incident triage" — the task's own named category.
 */
export function triageIncident(
  reference: string,
  assignee: string,
  note: string,
  idempotencyKey: string,
): Promise<MutationResult<IncidentOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/incidents/${encodeURIComponent(reference)}/triage`,
    { method: "POST", body: { assignee, note }, idempotencyKey },
    isIncidentOutputDto,
  );
}

/** `POST /security/incidents/:reference/mitigate` — `security:mitigate_incident`. `idempotent: true`. */
export function mitigateIncident(
  reference: string,
  note: string,
  idempotencyKey: string,
): Promise<MutationResult<IncidentOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/incidents/${encodeURIComponent(reference)}/mitigate`,
    { method: "POST", body: { note }, idempotencyKey },
    isIncidentOutputDto,
  );
}

/** `POST /security/incidents/:reference/resolve` — `security:resolve_incident`. `idempotent: true`. */
export function resolveIncident(
  reference: string,
  resolution: string,
  idempotencyKey: string,
): Promise<MutationResult<IncidentOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/incidents/${encodeURIComponent(reference)}/resolve`,
    { method: "POST", body: { resolution }, idempotencyKey },
    isIncidentOutputDto,
  );
}

/**
 * `POST /security/incidents/:reference/close` — `security:close_incident`. `idempotent: true` on the
 * backend, but a terminal, hard-to-undo transition — no route reopens a closed incident
 * (`Incident.TRANSITIONS`'s `closed: []`) — so constraint #10 confirms this client-side before
 * submit regardless, same discipline every other terminal action in this module uses.
 */
export function closeIncident(
  reference: string,
  note: string,
  idempotencyKey: string,
): Promise<MutationResult<IncidentOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/incidents/${encodeURIComponent(reference)}/close`,
    { method: "POST", body: { note }, idempotencyKey },
    isIncidentOutputDto,
  );
}

/**
 * `POST /security/incidents/:reference/evidence` (add) — `security:add_incident_evidence`. **Not**
 * `idempotent` on the backend (route table) — each call appends another evidence entry
 * (`Incident.addEvidence`), so a resubmit is not a no-op the way the 5 lifecycle actions above are.
 * Constraint #8 still mints a fresh `Idempotency-Key` per submit. Rejected server-side once the
 * incident is `closed` (`Incident.addEvidence`'s own guard) as a normal form error. `IncidentRowDto`
 * exposes `reference` per row, but the task brief lists this as its own standalone form rather than
 * folding it into the per-row lifecycle controls, so this module exposes it the same way.
 */
export function addIncidentEvidence(
  reference: string,
  kind: string,
  ref: string,
  idempotencyKey: string,
): Promise<MutationResult<IncidentOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/incidents/${encodeURIComponent(reference)}/evidence`,
    { method: "POST", body: { kind, ref }, idempotencyKey },
    isIncidentOutputDto,
  );
}

/**
 * The `ThreatVerdictOutput` DTO `checkThreatIndicator` returns (`services/security/src/application/
 * threat.use-cases.ts`) — a plain DTO.
 */
export interface ThreatVerdictDto {
  readonly indicator: string;
  readonly malicious: boolean;
  readonly score: number;
  readonly categories: readonly string[];
  readonly source: string;
  readonly providers: readonly string[];
}

function isThreatVerdictDto(value: unknown): value is ThreatVerdictDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { indicator?: unknown }).indicator === "string" &&
    typeof (value as { malicious?: unknown }).malicious === "boolean"
  );
}

/**
 * `POST /security/threat-indicators/check` — `security:check_threat_indicator`. **Not** `idempotent`
 * on the backend (route table) — per the task brief this is a lookup/simulation tool ("checks an
 * indicator across every registered threat-intel provider"), not a mutation whose lasting effect a
 * form should treat like a create; treated the same "try it" way `checkAiAction` (T5.12a) is. Still
 * records telemetry and a WORM audit record server-side when the verdict is malicious
 * (`CheckThreatIndicator.execute`'s own doc comment). Callers still resolve a fresh
 * `Idempotency-Key` per submit (constraint #8) even though this route ignores it.
 */
export function checkThreatIndicator(
  indicator: string,
  idempotencyKey: string,
): Promise<MutationResult<ThreatVerdictDto>> {
  return mutateAdminApi(
    `/api/v1/security/threat-indicators/check`,
    { method: "POST", body: { indicator }, idempotencyKey },
    isThreatVerdictDto,
  );
}

/** Mirrors `security-operations-routes.ts`'s `complianceFrameworkEnum` field-for-field. */
export type ComplianceFramework = "gdpr" | "soc2" | "iso27001" | "hipaa" | "pci_dss";

/** Mirrors `security-operations-routes.ts`'s `controlSeverityEnum` field-for-field. */
export type ComplianceControlSeverity = "low" | "medium" | "high" | "critical";

/**
 * The `ComplianceReportOutput` DTO `evaluateCompliance` returns (`services/security/src/
 * application/compliance.use-cases.ts`) — a plain DTO.
 */
export interface ComplianceFindingDto {
  readonly controlId: string;
  readonly status: string;
  readonly severity: string;
  readonly detail: string;
}
export interface ComplianceReportDto {
  readonly framework: string;
  readonly compliant: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly notApplicable: number;
  readonly findings: readonly ComplianceFindingDto[];
}

function isComplianceReportDto(value: unknown): value is ComplianceReportDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { framework?: unknown }).framework === "string" &&
    typeof (value as { compliant?: unknown }).compliant === "boolean" &&
    Array.isArray((value as { findings?: unknown }).findings)
  );
}

export interface EvaluateComplianceInput {
  readonly framework: ComplianceFramework;
  readonly tenantRef?: string | null;
  readonly attestations?: {
    readonly encryptionAtRest?: boolean;
    readonly consentTracked?: boolean;
    readonly retentionDefined?: boolean;
  };
}

/**
 * `POST /security/compliance/evaluate` — `security:evaluate_compliance`. **Not** `idempotent` on the
 * backend (route table) — an evaluation/read tool, not a mutation whose lasting effect a form should
 * treat like a create (same "try it" treatment as `checkThreatIndicator`/`checkAiAction`), though it
 * does derive live platform signals (audit-chain validity, MFA enforcement) and still emits
 * `security.compliance.evaluated` + a WORM audit record server-side
 * (`EvaluateCompliance.execute`'s own doc comment).
 */
export function evaluateCompliance(
  input: EvaluateComplianceInput,
  idempotencyKey: string,
): Promise<MutationResult<ComplianceReportDto>> {
  return mutateAdminApi(
    `/api/v1/security/compliance/evaluate`,
    { method: "POST", body: input, idempotencyKey },
    isComplianceReportDto,
  );
}

/**
 * The `RegistryEntryOutput` DTO `registerComplianceRule` returns (`services/security/src/
 * application/registry.use-cases.ts`) — a plain DTO shared with every other registry-registration
 * route (permissions, policy fragments, …), of which this module only needs the compliance-rule one.
 */
export interface ComplianceRuleRegistryEntryDto {
  readonly key: string;
  readonly version: number;
}

function isComplianceRuleRegistryEntryDto(value: unknown): value is ComplianceRuleRegistryEntryDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "string" &&
    typeof (value as { version?: unknown }).version === "number"
  );
}

export interface RegisterComplianceRuleInput {
  readonly id: string;
  readonly framework: ComplianceFramework;
  readonly description: string;
  readonly severity: ComplianceControlSeverity;
}

/**
 * `POST /security/compliance/rules` (register) — `security:register_compliance_rule`.
 * `idempotent: true` — registers (or re-registers, versioning up) a compliance control into the
 * versioned catalog by `id` (`RegisterComplianceRule.execute`).
 */
export function registerComplianceRule(
  input: RegisterComplianceRuleInput,
  idempotencyKey: string,
): Promise<MutationResult<ComplianceRuleRegistryEntryDto>> {
  return mutateAdminApi(
    `/api/v1/security/compliance/rules`,
    { method: "POST", body: input, idempotencyKey },
    isComplianceRuleRegistryEntryDto,
  );
}

// ── Sessions/Auth/Devices/MFA/Risk writes: establish/refresh/revoke session, revoke-all sessions,
// auth methods, authenticate, devices, MFA, risk evaluate (T5.12e) ─────────────────────────────
//
// The plan's named "session revocation" high-blast-radius category — `security-sessions-routes.ts`'s
// remaining 17 write routes, all delegating to `admin.securitySessions`
// (`apps/admin/src/interfaces/security-sessions.admin-controller.ts`). Verified against the actual
// read-model row shapes rather than assumed (same discipline T5.12a-d's own doc comments document):
// `SessionRowDto` (above) exposes `id` per row and `DeviceExplorerRowDto` exposes `fingerprint` per
// row, so session refresh/revoke and device signal/trust/block all attach as per-row controls on
// the session/device explorer tables. There is no MFA-enrollment explorer on this page at all (only
// session/device/risk explorers are wired, T3.1) and `RiskExplorerDto` exposes only an aggregate
// distribution, no individual rows — so auth-methods/authenticate, every MFA write, and risk
// evaluation all stay standalone forms with a manually-typed id, the same conclusion
// `ScheduleCredentialRotationForm` (T5.12c) and `suspendMachineIdentityAction`/`suspendAiIdentityAction`
// (T5.12a/b) already reached for their own id-less explorers.

function isSessionOutputDto(value: unknown): value is SessionOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

export interface EstablishSessionInput {
  readonly principalExternalId: string;
  readonly refreshFingerprint: string;
  readonly externalRef?: string | null;
  readonly deviceRef?: string | null;
  readonly ttlSeconds: number;
}

/**
 * `POST /security/sessions` (establish) — `security:establish_session`. `idempotent: true` on the
 * backend, though `EstablishSession.execute` (`services/security/src/application/
 * session.use-cases.ts`) mints a fresh session id every call — a resubmit issues a second session
 * for the same principal, so constraint #8's fresh `Idempotency-Key` per submit is what actually
 * prevents a double-click from establishing two.
 */
export function establishSession(
  input: EstablishSessionInput,
  idempotencyKey: string,
): Promise<MutationResult<SessionOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/sessions`,
    { method: "POST", body: input, idempotencyKey },
    isSessionOutputDto,
  );
}

export interface RefreshSessionInput {
  readonly newRefreshFingerprint: string;
  readonly ttlSeconds: number;
}

/**
 * `POST /security/sessions/:sessionId/refresh` — `security:refresh_session`. Rotates the refresh
 * token and extends the session (token rotation). A per-row control on the session explorer —
 * `sessionId` is re-derived from the submitted `FormData` (a per-row hidden field), same discipline
 * `triageIncidentAction` (T5.12d) documents for its own per-row `reference` field.
 */
export function refreshSession(
  sessionId: string,
  input: RefreshSessionInput,
  idempotencyKey: string,
): Promise<MutationResult<SessionOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/sessions/${encodeURIComponent(sessionId)}/refresh`,
    { method: "POST", body: input, idempotencyKey },
    isSessionOutputDto,
  );
}

/**
 * `POST /security/sessions/:sessionId/revoke` — `security:revoke_session`. No body. Logout /
 * forced revocation for one session — the literal "session revocation" control. A per-row control
 * on the session explorer, confirmed before submit (constraint #10).
 */
export function revokeSession(
  sessionId: string,
  idempotencyKey: string,
): Promise<MutationResult<SessionOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/sessions/${encodeURIComponent(sessionId)}/revoke`,
    { method: "POST", idempotencyKey },
    isSessionOutputDto,
  );
}

export interface RevokeAllSessionsResultDto {
  readonly revoked: number;
}

function isRevokeAllSessionsResultDto(value: unknown): value is RevokeAllSessionsResultDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { revoked?: unknown }).revoked === "number"
  );
}

/**
 * `POST /security/principals/:externalId/sessions/revoke-all` — `security:revoke_all_sessions`.
 * "Force logout everywhere" (`RevokeAllSessions.execute`'s own doc comment) — **the single
 * highest-blast-radius control in this part**. `idempotent: true` on the backend (a resubmit just
 * finds zero remaining active sessions to revoke), but confirmed client-side with an explicit
 * dialog naming the exact principal typed into the form, not the generic confirm text this module's
 * other destructive controls use — same treatment `EmergencyRevokeCredentialsForm` (T5.12c) gives
 * its own single highest-blast-radius action.
 */
export function revokeAllSessions(
  principalExternalId: string,
  idempotencyKey: string,
): Promise<MutationResult<RevokeAllSessionsResultDto>> {
  return mutateAdminApi(
    `/api/v1/security/principals/${encodeURIComponent(principalExternalId)}/sessions/revoke-all`,
    { method: "POST", idempotencyKey },
    isRevokeAllSessionsResultDto,
  );
}

/** Mirrors `security-sessions-routes.ts`'s `authMethodKindEnum` field-for-field (11 values). */
export type AuthMethodKind =
  | "password"
  | "passkey"
  | "magic_link"
  | "otp"
  | "email_verification"
  | "phone_verification"
  | "oauth"
  | "oidc"
  | "saml"
  | "ldap"
  | "enterprise_sso";

/**
 * The `AuthMethodOutput` DTO `registerAuthMethod` returns (`services/security/src/application/
 * authentication.use-cases.ts`) — a plain DTO, not a domain aggregate (README.md rule #2).
 */
export interface AuthMethodOutputDto {
  readonly kind: string;
  readonly version: number;
  readonly enabled: boolean;
  readonly displayName: string;
}

function isAuthMethodOutputDto(value: unknown): value is AuthMethodOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === "string" &&
    typeof (value as { version?: unknown }).version === "number"
  );
}

export interface RegisterAuthMethodInput {
  readonly kind: AuthMethodKind;
  readonly displayName: string;
  readonly enabled?: boolean;
  readonly config?: Readonly<Record<string, string>>;
}

/**
 * `POST /security/auth-methods` (register/update) — `security:register_auth_method`.
 * `idempotent: true` — registers or re-registers a method into the versioned Registry Engine by
 * `kind`. `config` (a free-form key/value bag) is left off the form deliberately — same call
 * `RegisterPrincipalForm` (T5.12b) makes for its own optional `attributes` bag: the brief calls out
 * `kind` specifically and never asks for a free-form key/value editor.
 */
export function registerAuthMethod(
  input: RegisterAuthMethodInput,
  idempotencyKey: string,
): Promise<MutationResult<AuthMethodOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/auth-methods`,
    { method: "POST", body: input, idempotencyKey },
    isAuthMethodOutputDto,
  );
}

/** Mirrors `mfa-engine.ts`'s `MfaRequirement` field-for-field. */
export type MfaRequirement = "none" | "optional" | "required" | "step_up";

/**
 * The `AuthenticationOutcome` DTO `authenticate` returns (`services/security/src/application/
 * authentication.use-cases.ts`) — a plain DTO. `reason` is only present on a failed attempt.
 */
export interface AuthenticationOutcomeDto {
  readonly authenticated: boolean;
  readonly principalExternalId: string | null;
  readonly sessionId: string | null;
  readonly mfaRequirement: string;
  readonly riskScore: number;
  readonly riskBand: string;
  readonly reason?: string;
}

function isAuthenticationOutcomeDto(value: unknown): value is AuthenticationOutcomeDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { authenticated?: unknown }).authenticated === "boolean" &&
    typeof (value as { riskScore?: unknown }).riskScore === "number"
  );
}

export interface AuthenticateInput {
  readonly method: AuthMethodKind;
  readonly identifier: string;
  readonly credential?: string;
  readonly deviceFingerprint?: string;
  readonly ip?: string;
  readonly sensitiveAction?: boolean;
  readonly rememberDevice?: boolean;
  readonly mfaSatisfied?: boolean;
  readonly sessionTtlSeconds?: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * `POST /security/authenticate` — `security:authenticate`. **Not** `idempotent` on the backend
 * (route table). Per the task brief this is a simulation/testing tool for this console — real
 * authentication happens outside the admin app — so it is treated as a "try it" preview panel, same
 * as `checkAiAction`/`checkThreatIndicator`: it does mutate (may establish a real session and write
 * a WORM audit record), but the UI surfaces the returned decision inline rather than treating it
 * like a create-and-navigate-away form. `metadata` is left off the form for the same reason
 * `config`/`attributes` are elsewhere in this module.
 */
export function authenticate(
  input: AuthenticateInput,
  idempotencyKey: string,
): Promise<MutationResult<AuthenticationOutcomeDto>> {
  return mutateAdminApi(
    `/api/v1/security/authenticate`,
    { method: "POST", body: input, idempotencyKey },
    isAuthenticationOutcomeDto,
  );
}

/**
 * The `DeviceOutput` DTO every device write returns (`services/security/src/application/
 * device.use-cases.ts`) — a plain DTO. Distinct from `DeviceExplorerRowDto` (above) only by the
 * addition of the device's internal `id`.
 */
export interface DeviceOutputDto {
  readonly id: string;
  readonly fingerprint: string;
  readonly principalRef: string | null;
  readonly trustLevel: string;
  readonly reputation: number;
  readonly anomalyCount: number;
  readonly lastSeenAt: string;
}

function isDeviceOutputDto(value: unknown): value is DeviceOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { fingerprint?: unknown }).fingerprint === "string" &&
    typeof (value as { trustLevel?: unknown }).trustLevel === "string"
  );
}

export interface RegisterDeviceInput {
  readonly fingerprint: string;
  readonly principalExternalId?: string;
  readonly tenantRef?: string | null;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * `POST /security/devices` (register) — `security:register_device`. `idempotent: true` per
 * `fingerprint`: `RegisterDevice.execute` returns the existing device unchanged on a repeat call
 * with the same fingerprint. Starts `untrusted`.
 */
export function registerDevice(
  input: RegisterDeviceInput,
  idempotencyKey: string,
): Promise<MutationResult<DeviceOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/devices`,
    { method: "POST", body: input, idempotencyKey },
    isDeviceOutputDto,
  );
}

/** Mirrors `security-sessions-routes.ts`'s `signalSeverityEnum` field-for-field. */
export type DeviceSignalSeverity = "low" | "medium" | "high";

export interface RecordDeviceSignalInput {
  readonly type: string;
  readonly severity: DeviceSignalSeverity;
}

/**
 * `POST /security/devices/:fingerprint/signals` (record) — `security:record_device_signal`.
 * **Not** `idempotent` on the backend (route table) — each call lowers reputation and counts
 * another anomaly (`Device.recordSignal`), so a resubmit is not a no-op. A per-row control on the
 * device explorer.
 */
export function recordDeviceSignal(
  fingerprint: string,
  input: RecordDeviceSignalInput,
  idempotencyKey: string,
): Promise<MutationResult<DeviceOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/devices/${encodeURIComponent(fingerprint)}/signals`,
    { method: "POST", body: input, idempotencyKey },
    isDeviceOutputDto,
  );
}

/**
 * `POST /security/devices/:fingerprint/trust` — `security:trust_device`. No body. Explicit
 * remember-device trust. `idempotent: true`. A per-row control on the device explorer.
 */
export function trustDevice(
  fingerprint: string,
  idempotencyKey: string,
): Promise<MutationResult<DeviceOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/devices/${encodeURIComponent(fingerprint)}/trust`,
    { method: "POST", idempotencyKey },
    isDeviceOutputDto,
  );
}

/**
 * `POST /security/devices/:fingerprint/block` — `security:block_device`. No body.
 * `idempotent: true`. A per-row control on the device explorer, confirmed before submit
 * (constraint #10).
 */
export function blockDevice(
  fingerprint: string,
  idempotencyKey: string,
): Promise<MutationResult<DeviceOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/devices/${encodeURIComponent(fingerprint)}/block`,
    { method: "POST", idempotencyKey },
    isDeviceOutputDto,
  );
}

/** Mirrors `security-sessions-routes.ts`'s `mfaMethodKindEnum` field-for-field (5 values). */
export type MfaMethodKind = "totp" | "webauthn" | "sms_otp" | "email_otp" | "backup_code";

/**
 * The `MfaEnrollmentOutput` DTO every MFA-enrollment write returns (`services/security/src/
 * application/mfa.use-cases.ts`) — a plain DTO, never the secret/backup-code hashes themselves.
 */
export interface MfaEnrollmentOutputDto {
  readonly id: string;
  readonly principalRef: string;
  readonly method: string;
  readonly status: string;
  readonly remainingBackupCodes: number;
}

function isMfaEnrollmentOutputDto(value: unknown): value is MfaEnrollmentOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

export interface EnrollMfaInput {
  readonly principalExternalId: string;
  readonly method: MfaMethodKind;
}

/**
 * `POST /security/mfa/enrollments` (enroll) — `security:enroll_mfa`. `idempotent: true`. No
 * MFA-enrollment explorer is wired on this page (only session/device/risk explorers, T3.1), so this
 * is a standalone form with manually-typed `principalExternalId`, same reasoning
 * `ScheduleCredentialRotationForm` (T5.12c) documents for its own id-less explorer.
 */
export function enrollMfa(
  input: EnrollMfaInput,
  idempotencyKey: string,
): Promise<MutationResult<MfaEnrollmentOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/mfa/enrollments`,
    { method: "POST", body: input, idempotencyKey },
    isMfaEnrollmentOutputDto,
  );
}

/**
 * `POST /security/mfa/enrollments/:enrollmentId/verify` — `security:verify_mfa_enrollment`.
 * `idempotent: true`. Activates a pending enrollment once the provider confirms the submitted code.
 * Standalone form (see `enrollMfa`'s doc comment) with a manually-typed `enrollmentId`.
 */
export function verifyMfaEnrollment(
  enrollmentId: string,
  code: string,
  idempotencyKey: string,
): Promise<MutationResult<MfaEnrollmentOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/mfa/enrollments/${encodeURIComponent(enrollmentId)}/verify`,
    { method: "POST", body: { code }, idempotencyKey },
    isMfaEnrollmentOutputDto,
  );
}

export interface BackupCodesOutputDto {
  readonly codes: readonly string[];
}

function isBackupCodesOutputDto(value: unknown): value is BackupCodesOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { codes?: unknown }).codes)
  );
}

/**
 * `POST /security/mfa/enrollments/:enrollmentId/backup-codes` (generate) —
 * `security:generate_backup_codes`. **Not** `idempotent` on the backend — every call replaces the
 * existing codes with a brand-new set (`GenerateBackupCodes.execute`'s own doc comment: "Replaces
 * any existing codes"). Only the non-reversible hashes are ever persisted — this response is the
 * **only** time the plaintext codes exist outside the caller's screen. The UI must display them
 * prominently in the success state with a copy affordance, never log them, and never persist them
 * client-side beyond the success render (constraint #10) — see `GenerateBackupCodesPanel`.
 */
export function generateBackupCodes(
  enrollmentId: string,
  count: number | undefined,
  idempotencyKey: string,
): Promise<MutationResult<BackupCodesOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/mfa/enrollments/${encodeURIComponent(enrollmentId)}/backup-codes`,
    { method: "POST", body: { count }, idempotencyKey },
    isBackupCodesOutputDto,
  );
}

/**
 * `POST /security/mfa/enrollments/:enrollmentId/revoke` — `security:revoke_mfa`. No body.
 * `idempotent: true`. Standalone form (see `enrollMfa`'s doc comment), confirmed before submit
 * (constraint #10).
 */
export function revokeMfa(
  enrollmentId: string,
  idempotencyKey: string,
): Promise<MutationResult<MfaEnrollmentOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/mfa/enrollments/${encodeURIComponent(enrollmentId)}/revoke`,
    { method: "POST", idempotencyKey },
    isMfaEnrollmentOutputDto,
  );
}

/** Mirrors `security-sessions-routes.ts`'s `riskBandEnum` field-for-field. */
export type RiskBand = "low" | "moderate" | "elevated" | "high";

/**
 * The `MfaDecision` DTO `decideMfa` returns (`services/security/src/domain/mfa-engine.ts`) — a
 * plain DTO from the MFA Engine, explainable via `reasons`.
 */
export interface MfaDecisionDto {
  readonly requirement: string;
  readonly reasons: readonly string[];
}

function isMfaDecisionDto(value: unknown): value is MfaDecisionDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { requirement?: unknown }).requirement === "string" &&
    Array.isArray((value as { reasons?: unknown }).reasons)
  );
}

export interface DecideMfaInput {
  readonly principalExternalId: string;
  readonly deviceFingerprint?: string;
  readonly riskBand: RiskBand;
  readonly sensitiveAction?: boolean;
  readonly rememberDevice?: boolean;
}

/**
 * `POST /security/mfa/decide` — `security:decide_mfa`. **Not** `idempotent` on the backend, and
 * "read-only" per its own route summary despite being a POST — a simulation/preview panel (what MFA
 * would this risk band require), not a mutation. Never `revalidatePath`s.
 */
export function decideMfa(
  input: DecideMfaInput,
  idempotencyKey: string,
): Promise<MutationResult<MfaDecisionDto>> {
  return mutateAdminApi(
    `/api/v1/security/mfa/decide`,
    { method: "POST", body: input, idempotencyKey },
    isMfaDecisionDto,
  );
}

/**
 * The `RegistryEntryOutput` DTO `registerMfaMethod` returns (`services/security/src/application/
 * registry.use-cases.ts`) — the same shape `ComplianceRuleRegistryEntryDto` (T5.12d) already types
 * for its own registry-registration route, given its own name here to keep this section
 * self-contained.
 */
export interface MfaMethodRegistryEntryDto {
  readonly key: string;
  readonly version: number;
}

function isMfaMethodRegistryEntryDto(value: unknown): value is MfaMethodRegistryEntryDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "string" &&
    typeof (value as { version?: unknown }).version === "number"
  );
}

export interface RegisterMfaMethodInput {
  readonly kind: MfaMethodKind;
  readonly displayName: string;
  readonly enabled?: boolean;
}

/**
 * `POST /security/mfa/methods` (register/update) — `security:register_mfa_method`.
 * `idempotent: true` — registers/re-registers an MFA method definition into the versioned Registry
 * Engine by `kind`.
 */
export function registerMfaMethod(
  input: RegisterMfaMethodInput,
  idempotencyKey: string,
): Promise<MutationResult<MfaMethodRegistryEntryDto>> {
  return mutateAdminApi(
    `/api/v1/security/mfa/methods`,
    { method: "POST", body: input, idempotencyKey },
    isMfaMethodRegistryEntryDto,
  );
}

/**
 * The `RiskFactor` shape `evaluateRisk` returns inside its `factors` array
 * (`services/security/src/domain/risk-engine.ts`) — explainable per-factor detail.
 */
export interface RiskFactorDto {
  readonly code: string;
  readonly contribution: number;
  readonly detail: string;
}

/**
 * The `RiskEvaluationOutput` DTO `evaluateRisk` returns (`services/security/src/application/
 * risk.use-cases.ts`) — a plain DTO, deterministic and explainable (every factor is returned).
 */
export interface RiskEvaluationDto {
  readonly score: number;
  readonly band: string;
  readonly factors: readonly RiskFactorDto[];
}

function isRiskEvaluationDto(value: unknown): value is RiskEvaluationDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { score?: unknown }).score === "number" &&
    Array.isArray((value as { factors?: unknown }).factors)
  );
}

export interface EvaluateRiskInput {
  readonly principalExternalId?: string;
  readonly ip?: string;
  readonly deviceFingerprint?: string;
}

/**
 * `POST /security/risk/evaluate` — `security:evaluate_risk`. **Not** `idempotent` on the backend —
 * a preview/explainer tool ("explainable factors") per the task brief, not a mutation. Never
 * `revalidatePath`s, same "try it" treatment as `decideMfa`/`authenticate` in this section.
 */
export function evaluateRisk(
  input: EvaluateRiskInput,
  idempotencyKey: string,
): Promise<MutationResult<RiskEvaluationDto>> {
  return mutateAdminApi(
    `/api/v1/security/risk/evaluate`,
    { method: "POST", body: input, idempotencyKey },
    isRiskEvaluationDto,
  );
}

// ── Access writes: roles, policies, ReBAC relations, access checks, registries, delegations &
// impersonation, tenant security profile (T5.12f — LAST) ───────────────────────────────────────
//
// The plan's explicit "policy definition" high-blast-radius category — `security-authorization-
// routes.ts`'s (421 lines, the largest route file in the codebase) 18 write routes, all delegating
// to `admin.securityAuthorization` (`apps/admin/src/interfaces/security-authorization.admin-
// controller.ts`). Three backend fields (`PolicyRule.when`/`.expr`, `PolicyFragment.expression`,
// `CheckAccessInput.abac`) are typed `z.unknown()` on the backend — a recursive expression-language
// type (`PolicyExpression`/`PolicyCondition`/`AbacCondition`) validated by the domain, not zod — so
// this module never fabricates a typed shape for them. `rules` (the whole array
// `publishPolicyVersion` takes, including each rule's `when`/`expr`) is treated as one raw JSON
// value end to end rather than a partially-structured per-rule editor, same technique T5.9c's
// Component Library `defaults` field used (see `ComponentCreateForm`'s doc comment) — the task brief
// explicitly rules out building a structured policy-rule editor.
//
// Verified against `RoleSummaryRowDto`/`PolicySummaryRowDto`/`PolicyExplorerRowDto`/
// `RegistrySummaryRowDto` (above, T3.1) rather than assumed: roles and policies both expose `key`
// per row, so grant-permission/publish/archive attach as per-row controls; the registry explorer's
// rows are keyed by registry *name* with a nested `entries` array (permissions/fragments/MFA
// methods/compliance rules all share one registry list), not a per-registry-kind row a "register"
// form could prefill from, and there is no delegation/assignment/tuple explorer wired on this page
// at all — so every other write below (role assignments, define-role, define-policy, simulate,
// relations, both access-check preview panels, both registrations, delegations/impersonation, tenant
// security) is a standalone form with manually-typed keys/ids, the same conclusion T5.12a-e's own
// doc comments reach for their own id-less explorers.

/** Mirrors `security-authorization-routes.ts`'s `securityScopeSchema` field-for-field. */
export interface SecurityScopeInput {
  readonly organization?: string;
  readonly tenant?: string;
  readonly workspace?: string;
  readonly environment?: string;
}

/** Mirrors `security-authorization-routes.ts`'s `policyModeEnum`. */
export type PolicyMode = "strict" | "balanced" | "relaxed" | "custom";

/** Mirrors `security-authorization-routes.ts`'s `policyEffectEnum`. */
export type PolicyEffect = "allow" | "challenge" | "block" | "review";

/** Mirrors `security-authorization-routes.ts`'s `isolationTierEnum`. */
export type IsolationTier = "pooled" | "dedicated_schema" | "dedicated_db";

// -- Roles --

/**
 * The `RoleOutput` DTO `defineRole`/`grantRolePermission` return (`services/security/src/
 * application/authorization.use-cases.ts`'s `presentRole()`) — a plain DTO, not the `Role`
 * aggregate (README.md rule #2).
 */
export interface RoleOutputDto {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly parentKey: string | null;
  readonly isTemplate: boolean;
  readonly status: string;
  readonly scope: string;
}

function isRoleOutputDto(value: unknown): value is RoleOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

export interface DefineRoleInput {
  readonly key: string;
  readonly name: string;
  readonly scope?: SecurityScopeInput;
  readonly permissions?: readonly string[];
  readonly parentKey?: string | null;
  readonly isTemplate?: boolean;
}

/** `POST /security/roles` (define) — `security:define_role`. `idempotent: true` per `key`. Standalone form. */
export function defineRole(
  input: DefineRoleInput,
  idempotencyKey: string,
): Promise<MutationResult<RoleOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/roles`,
    { method: "POST", body: input, idempotencyKey },
    isRoleOutputDto,
  );
}

/**
 * `POST /security/roles/:roleKey/permissions` (grant) — `security:grant_role_permission`.
 * `idempotent: true`. A per-row control on the permission explorer's Roles table (`RoleSummaryRowDto`
 * exposes `key` per row, verified above).
 */
export function grantRolePermission(
  roleKey: string,
  permission: string,
  idempotencyKey: string,
): Promise<MutationResult<RoleOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/roles/${encodeURIComponent(roleKey)}/permissions`,
    { method: "POST", body: { permission }, idempotencyKey },
    isRoleOutputDto,
  );
}

/**
 * The `AssignmentOutput` DTO `assignRole`/`revokeRoleAssignment` return (`services/security/src/
 * application/authorization.use-cases.ts`'s `presentAssignment()`) — a plain DTO, not the
 * `RoleAssignment` aggregate.
 */
export interface RoleAssignmentOutputDto {
  readonly id: string;
  readonly principalRef: string;
  readonly roleKey: string;
  readonly status: string;
  readonly scope: string;
  readonly grantedBy: string;
  readonly expiresAt: string | null;
}

function isRoleAssignmentOutputDto(value: unknown): value is RoleAssignmentOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

export interface AssignRoleInput {
  readonly principalExternalId: string;
  readonly roleKey: string;
  readonly grantedBy: string;
  readonly scope?: SecurityScopeInput;
  readonly ttlSeconds?: number;
  readonly reason?: string;
}

/**
 * `POST /security/role-assignments` (assign) — `security:assign_role`. `idempotent: true`.
 * `grantedBy` is the audit actor — same "pre-fill from the current admin user" pattern Feature
 * Flags' `changedBy` uses, see `AssignRoleForm`. Standalone form (no assignment explorer is wired
 * on this page).
 */
export function assignRole(
  input: AssignRoleInput,
  idempotencyKey: string,
): Promise<MutationResult<RoleAssignmentOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/role-assignments`,
    { method: "POST", body: input, idempotencyKey },
    isRoleAssignmentOutputDto,
  );
}

/**
 * `POST /security/role-assignments/:assignmentId/revoke` — `security:revoke_role_assignment`.
 * `idempotent: true`. Standalone form, confirmed before submit (constraint #10).
 */
export function revokeRoleAssignment(
  assignmentId: string,
  idempotencyKey: string,
): Promise<MutationResult<RoleAssignmentOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/role-assignments/${encodeURIComponent(assignmentId)}/revoke`,
    { method: "POST", idempotencyKey },
    isRoleAssignmentOutputDto,
  );
}

// -- Policies (the core "policy definition" controls) --

/**
 * The `PolicyOutput` DTO every policy-lifecycle write returns (`services/security/src/application/
 * policy.use-cases.ts`'s `present()`) — a plain DTO, not the `Policy` aggregate.
 */
export interface PolicyOutputDto {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly mode: string;
  readonly status: string;
  readonly activeVersion: number | null;
  readonly versionCount: number;
}

function isPolicyOutputDto(value: unknown): value is PolicyOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

export interface DefinePolicyInput {
  readonly key: string;
  readonly name: string;
  readonly mode: PolicyMode;
}

/** `POST /security/policies` (define) — `security:define_policy`. `idempotent: true` per `key`; starts `draft`. Standalone form. */
export function definePolicy(
  input: DefinePolicyInput,
  idempotencyKey: string,
): Promise<MutationResult<PolicyOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/policies`,
    { method: "POST", body: input, idempotencyKey },
    isPolicyOutputDto,
  );
}

/**
 * `POST /security/policies/:policyKey/versions` (publish) — `security:publish_policy_version`.
 * `idempotent: true`. `rules` is sent verbatim as parsed JSON (a `readonly unknown[]`) — each rule's
 * `{id, description, when, expr?, effect}` including the backend's own `z.unknown()` `when`/`expr`
 * fields, per this section's header doc comment; the caller-side JSON textarea (`PublishPolicy
 * VersionForm`) is the only client-side validation before this reaches the wire. A live-traffic
 * policy change — the UI confirms this one explicitly, naming the policy key (constraint #10, task
 * brief). A per-row control on the Policies table (`PolicySummaryRowDto`/`PolicyExplorerRowDto`
 * expose `key` per row).
 */
export function publishPolicyVersion(
  policyKey: string,
  rules: readonly unknown[],
  defaultEffect: PolicyEffect | undefined,
  idempotencyKey: string,
): Promise<MutationResult<PolicyOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/policies/${encodeURIComponent(policyKey)}/versions`,
    { method: "POST", body: { rules, defaultEffect }, idempotencyKey },
    isPolicyOutputDto,
  );
}

/**
 * `POST /security/policies/:policyKey/archive` — `security:archive_policy`. `idempotent: true`. A
 * per-row control on the Policies table, confirmed before submit (constraint #10).
 */
export function archivePolicy(
  policyKey: string,
  idempotencyKey: string,
): Promise<MutationResult<PolicyOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/policies/${encodeURIComponent(policyKey)}/archive`,
    { method: "POST", idempotencyKey },
    isPolicyOutputDto,
  );
}

export interface SimulatePolicyContextInput {
  readonly principalActive?: boolean;
  readonly sessionValid?: boolean;
  readonly permissionGranted?: boolean;
  readonly deviceTrusted?: boolean;
  readonly risk?: number;
  readonly trust?: number;
  readonly environment?: string | null;
  readonly resource?: string | null;
}

/**
 * The `ZeroTrustDecision` DTO both `simulatePolicy` and (wrapped further) `evaluateAccess` derive
 * from (`services/security/src/domain/zero-trust.ts`) — a plain, explainable DTO.
 */
export interface ZeroTrustDecisionDto {
  readonly effect: string;
  readonly reasons: readonly string[];
  readonly matchedRuleIds: readonly string[];
  readonly policyVersion: number | null;
}

function isZeroTrustDecisionDto(value: unknown): value is ZeroTrustDecisionDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { effect?: unknown }).effect === "string" &&
    Array.isArray((value as { reasons?: unknown }).reasons)
  );
}

/**
 * `POST /security/policies/:policyKey/simulate` — `security:simulate_policy`. **Not** `idempotent`
 * on the backend, and "(read-only)" per its own route summary — a pure what-if against real policy
 * data (`SimulatePolicy.execute`'s own doc comment: "no persistence, no audit"). A standalone
 * preview panel with a manually-typed `policyKey`, same "try it" treatment as
 * `decideMfa`/`evaluateRisk` (T5.12e). Never `revalidatePath`s.
 */
export function simulatePolicy(
  policyKey: string,
  context: SimulatePolicyContextInput,
  idempotencyKey: string,
): Promise<MutationResult<ZeroTrustDecisionDto>> {
  return mutateAdminApi(
    `/api/v1/security/policies/${encodeURIComponent(policyKey)}/simulate`,
    { method: "POST", body: { context }, idempotencyKey },
    isZeroTrustDecisionDto,
  );
}

// -- ReBAC relations --

export interface RelationTupleWriteInput {
  readonly namespace: string;
  readonly object: string;
  readonly relation: string;
  readonly subject: string;
}

export interface RelationTupleOutputDto {
  readonly key: string;
}

function isRelationTupleOutputDto(value: unknown): value is RelationTupleOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "string"
  );
}

/** `POST /security/relations` (write tuple) — `security:write_relation_tuple`. `idempotent: true` by key. Standalone form. */
export function writeRelationTuple(
  input: RelationTupleWriteInput,
  idempotencyKey: string,
): Promise<MutationResult<RelationTupleOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/relations`,
    { method: "POST", body: input, idempotencyKey },
    isRelationTupleOutputDto,
  );
}

export interface DeleteRelationTupleResultDto {
  readonly removed: boolean;
}

function isDeleteRelationTupleResultDto(value: unknown): value is DeleteRelationTupleResultDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { removed?: unknown }).removed === "boolean"
  );
}

/**
 * `POST /security/relations/delete` — `security:delete_relation_tuple`. `idempotent: true` — same
 * body shape as `writeRelationTuple` (identifies the tuple by its 4 components, not a stored id, per
 * the task brief). Standalone form, confirmed before submit (constraint #10).
 */
export function deleteRelationTuple(
  input: RelationTupleWriteInput,
  idempotencyKey: string,
): Promise<MutationResult<DeleteRelationTupleResultDto>> {
  return mutateAdminApi(
    `/api/v1/security/relations/delete`,
    { method: "POST", body: input, idempotencyKey },
    isDeleteRelationTupleResultDto,
  );
}

// -- Access checks (read-only tools, not mutations) --

export interface CheckAccessInput {
  readonly principalExternalId: string;
  readonly permission: string;
  readonly scope?: SecurityScopeInput;
  readonly namespace?: string;
  readonly object?: string;
  readonly relation?: string;
  /** The backend's `z.unknown()` `AbacCondition` field — a raw JSON textarea, per this section's header doc comment. */
  readonly abac?: unknown;
}

/** The `AbacMismatch` shape (`services/security/src/domain/abac.ts`) — one unmet attribute, for explanation. */
export interface AbacMismatchDto {
  readonly dimension: string;
  readonly attribute: string;
  readonly expected: string;
  readonly actual: string | null;
}

/**
 * The `AccessModelDecision` DTO `checkAccess` returns (`services/security/src/application/
 * authz.use-cases.ts`) — a plain, explainable DTO.
 */
export interface AccessModelDecisionDto {
  readonly allowed: boolean;
  readonly grantedBy: readonly string[];
  readonly abacSatisfied: boolean;
  readonly abacMismatches: readonly AbacMismatchDto[];
  readonly reasons: readonly string[];
}

function isAccessModelDecisionDto(value: unknown): value is AccessModelDecisionDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { allowed?: unknown }).allowed === "boolean" &&
    Array.isArray((value as { grantedBy?: unknown }).grantedBy)
  );
}

/**
 * `POST /security/access/check` — `security:check_access`. **Not** `idempotent` — "unified
 * authorization check across RBAC, ReBAC, and ABAC" per its own route summary; a preview/explainer
 * tool (though it still records a WORM audit record server-side, `CheckAccess.execute`). Standalone
 * panel, same "try it" treatment as `evaluateRisk`/`decideMfa` (T5.12e). Never `revalidatePath`s.
 */
export function checkAccess(
  input: CheckAccessInput,
  idempotencyKey: string,
): Promise<MutationResult<AccessModelDecisionDto>> {
  return mutateAdminApi(
    `/api/v1/security/access/check`,
    { method: "POST", body: input, idempotencyKey },
    isAccessModelDecisionDto,
  );
}

/** Mirrors `security-authorization-routes.ts`'s `riskSignalsSchema` field-for-field. */
export interface RiskSignalsInput {
  readonly failedAuthCount?: number;
  readonly newDevice?: boolean;
  readonly impossibleTravel?: boolean;
  readonly threatIntelHit?: boolean;
  readonly ipReputation?: number;
}

/** Mirrors `security-authorization-routes.ts`'s `trustSignalsSchema` field-for-field. */
export interface TrustSignalsInput {
  readonly deviceTrusted?: boolean;
  readonly mfaSatisfied?: boolean;
  readonly sessionAgeDays?: number;
  readonly knownGoodPrincipal?: boolean;
}

export interface EvaluateAccessInput {
  readonly principalExternalId: string;
  readonly permission: string;
  readonly sessionId?: string;
  readonly resource?: string;
  readonly scope?: SecurityScopeInput;
  readonly environment?: string;
  readonly deviceRef?: string;
  readonly policyKey?: string;
  readonly risk?: RiskSignalsInput;
  readonly trust?: TrustSignalsInput;
}

/**
 * The `AccessDecisionOutput` DTO `evaluateAccess` returns (`services/security/src/application/
 * access.use-cases.ts`) — a plain, explainable DTO.
 */
export interface AccessDecisionOutputDto {
  readonly effect: string;
  readonly allowed: boolean;
  readonly reasons: readonly string[];
  readonly matchedRuleIds: readonly string[];
  readonly policyKey: string | null;
  readonly policyVersion: number | null;
  readonly risk: number;
  readonly trust: number;
  readonly roleKeys: readonly string[];
  readonly auditId: string;
}

function isAccessDecisionOutputDto(value: unknown): value is AccessDecisionOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { allowed?: unknown }).allowed === "boolean" &&
    typeof (value as { auditId?: unknown }).auditId === "string"
  );
}

/**
 * `POST /security/access/evaluate` — `security:evaluate_access`. **Not** `idempotent` — "the
 * platform's single authorization entry point" per its own route summary; every call is a real,
 * WORM-audited decision (`EvaluateAccess.execute`), but per the task brief this is still surfaced as
 * a preview/explainer panel rather than a create-and-navigate-away form — same treatment
 * `authenticate` (T5.12e) gives its own real-but-simulation-shaped route. Never `revalidatePath`s.
 */
export function evaluateAccess(
  input: EvaluateAccessInput,
  idempotencyKey: string,
): Promise<MutationResult<AccessDecisionOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/access/evaluate`,
    { method: "POST", body: input, idempotencyKey },
    isAccessDecisionOutputDto,
  );
}

// -- Registries --

/**
 * The `RegistryEntryOutput` DTO both registration routes below return (`services/security/src/
 * application/registry.use-cases.ts`) — the same shape `ComplianceRuleRegistryEntryDto`/
 * `MfaMethodRegistryEntryDto` (T5.12d/e) already type for their own registry-registration routes,
 * given its own name here to keep this section self-contained.
 */
export interface RegistryEntryOutputDto {
  readonly key: string;
  readonly version: number;
}

function isRegistryEntryOutputDto(value: unknown): value is RegistryEntryOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "string" &&
    typeof (value as { version?: unknown }).version === "number"
  );
}

export interface RegisterPolicyFragmentInput {
  readonly key: string;
  readonly description?: string;
  /** The backend's `z.unknown()` `PolicyExpression` field — a raw JSON textarea, per this section's header doc comment. */
  readonly expression: unknown;
}

/**
 * `POST /security/policy-fragments` (register) — `security:register_policy_fragment`.
 * `idempotent: true`. Standalone form.
 */
export function registerPolicyFragment(
  input: RegisterPolicyFragmentInput,
  idempotencyKey: string,
): Promise<MutationResult<RegistryEntryOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/policy-fragments`,
    { method: "POST", body: input, idempotencyKey },
    isRegistryEntryOutputDto,
  );
}

export interface RegisterPermissionInput {
  readonly permission: string;
  readonly description: string;
}

/** `POST /security/permissions` (register) — `security:register_permission`. `idempotent: true`. Standalone form. */
export function registerPermission(
  input: RegisterPermissionInput,
  idempotencyKey: string,
): Promise<MutationResult<RegistryEntryOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/permissions`,
    { method: "POST", body: input, idempotencyKey },
    isRegistryEntryOutputDto,
  );
}

// -- Delegations & impersonation (the second-highest-risk group in this part) --

/**
 * The `DelegationOutput` DTO every delegation-lifecycle write returns (`services/security/src/
 * application/delegation.use-cases.ts`'s `present()`) — a plain DTO, not the `Delegation` aggregate.
 */
export interface DelegationOutputDto {
  readonly id: string;
  readonly delegatorRef: string;
  readonly delegateRef: string;
  readonly status: string;
  readonly scope: string;
  readonly expiresAt: string | null;
}

function isDelegationOutputDto(value: unknown): value is DelegationOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

export interface GrantDelegationInput {
  readonly delegatorExternalId: string;
  readonly delegateExternalId: string;
  readonly scope?: SecurityScopeInput;
  readonly permissions?: readonly string[];
  readonly ttlSeconds?: number;
  readonly reason?: string;
}

/**
 * `POST /security/delegations` (grant) — `security:grant_delegation`. `idempotent: true`. "One
 * principal may act as another, time-boxed" — standalone form.
 */
export function grantDelegation(
  input: GrantDelegationInput,
  idempotencyKey: string,
): Promise<MutationResult<DelegationOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/delegations`,
    { method: "POST", body: input, idempotencyKey },
    isDelegationOutputDto,
  );
}

/**
 * `POST /security/delegations/:delegationId/revoke` — `security:revoke_delegation`.
 * `idempotent: true`. Standalone form (no delegation explorer is wired on this page), confirmed
 * before submit (constraint #10).
 */
export function revokeDelegation(
  delegationId: string,
  idempotencyKey: string,
): Promise<MutationResult<DelegationOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/delegations/${encodeURIComponent(delegationId)}/revoke`,
    { method: "POST", idempotencyKey },
    isDelegationOutputDto,
  );
}

export interface StartImpersonationInput {
  readonly refreshFingerprint: string;
  readonly ttlSeconds: number;
}

/**
 * The `ImpersonationOutput` DTO `startImpersonation` returns (`services/security/src/application/
 * delegation.use-cases.ts`) — a plain DTO.
 */
export interface ImpersonationOutputDto {
  readonly sessionId: string;
  readonly actingAs: string;
  readonly impersonatedBy: string;
  readonly expiresAt: string;
}

function isImpersonationOutputDto(value: unknown): value is ImpersonationOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { sessionId?: unknown }).sessionId === "string" &&
    typeof (value as { actingAs?: unknown }).actingAs === "string"
  );
}

/**
 * `POST /security/delegations/:delegationId/impersonate` (start) — `security:start_impersonation`.
 * `idempotent: true` on the backend, but **the single highest-risk individual action in this entire
 * phase** per the task brief — starting an impersonation session lets one principal act as another.
 * No delegation explorer is wired on this page, so `StartImpersonationForm` collects
 * `delegatorExternalId`/`delegateExternalId` purely as admin-typed, display-only context for its own
 * unmistakable confirmation dialog (never sent in this route's body — the backend resolves both
 * from `delegationId` itself, which is the only identifier this function actually forwards) plus a
 * type-the-delegation-id-to-confirm friction step, on top of the `window.confirm` dialog every other
 * destructive control in this module uses (constraint #10, task brief's own judgment call).
 */
export function startImpersonation(
  delegationId: string,
  input: StartImpersonationInput,
  idempotencyKey: string,
): Promise<MutationResult<ImpersonationOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/delegations/${encodeURIComponent(delegationId)}/impersonate`,
    { method: "POST", body: input, idempotencyKey },
    isImpersonationOutputDto,
  );
}

// -- Tenant security --

/**
 * The `TenantSecurityProfileOutput` DTO `configureTenantSecurity` returns (`services/security/src/
 * application/tenant-security.use-cases.ts`) — a plain DTO, not the `TenantSecurityProfile`
 * aggregate.
 */
export interface TenantSecurityProfileOutputDto {
  readonly id: string;
  readonly tenantRef: string;
  readonly isolationTier: string;
  readonly residencyRegion: string;
  readonly securityMode: string;
  readonly mfaRequired: boolean;
  readonly allowedAuthMethods: readonly string[];
  readonly defaultPolicyKey: string | null;
}

function isTenantSecurityProfileOutputDto(
  value: unknown,
): value is TenantSecurityProfileOutputDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { tenantRef?: unknown }).tenantRef === "string" &&
    typeof (value as { securityMode?: unknown }).securityMode === "string"
  );
}

/** Mirrors `security-authorization-routes.ts`'s `configureTenantSecurityBody` field-for-field. */
export interface ConfigureTenantSecurityConfigInput {
  readonly isolationTier?: IsolationTier;
  readonly residencyRegion?: string;
  readonly securityMode?: PolicyMode;
  readonly mfaRequired?: boolean;
  readonly allowedAuthMethods?: readonly string[];
  readonly defaultPolicyKey?: string | null;
}

/**
 * `POST /security/tenants/:tenantRef/security-profile` (configure) —
 * `security:configure_tenant_security`. `idempotent: true` — create-or-patch: the first call
 * creates the tenant's security profile, later calls patch it. The route's own body schema *is*
 * the flat config object (the handler reshapes it into `{tenantRef, config: body}` server-side), so
 * this sends `config` directly as the request body — not wrapped in a `{config}` envelope like
 * `governAiIdentity`/`governMachineIdentity` (T5.12a/b) do for their own differently-shaped routes.
 * Standalone form.
 */
export function configureTenantSecurity(
  tenantRef: string,
  config: ConfigureTenantSecurityConfigInput,
  idempotencyKey: string,
): Promise<MutationResult<TenantSecurityProfileOutputDto>> {
  return mutateAdminApi(
    `/api/v1/security/tenants/${encodeURIComponent(tenantRef)}/security-profile`,
    { method: "POST", body: config, idempotencyKey },
    isTenantSecurityProfileOutputDto,
  );
}

// ── Shared ───────────────────────────────────────────────────────────────────────────────────────

/** Collapses `getAdminApi`'s 4-outcome `ApiResult` down to the 3 outcomes every console screen
 * (endpoints with no path param — nothing to 404 on) actually needs to render. */
function toSimpleResult<T>(
  result:
    | { readonly outcome: "ok"; readonly data: T }
    | { readonly outcome: "unauthorized" }
    | { readonly outcome: "not_found" }
    | { readonly outcome: "error"; readonly message: string },
):
  | { readonly outcome: "ok"; readonly data: T }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string } {
  if (result.outcome === "ok") return { outcome: "ok", data: result.data };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  if (result.outcome === "not_found") return { outcome: "error", message: "Not found" };
  return { outcome: "error", message: result.message };
}
