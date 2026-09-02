/**
 * @platform/entitlement — the EntitlementGuard (Platform Kernel, ADR-0027/ADR-0029). The permanent runtime
 * **enforcement point** (PEP) that gates every protected command/API/GraphQL/admin action/job/workflow/scheduled
 * task/AI request/marketplace operation/SDK call on a tenant×feature entitlement decision. Fail-closed,
 * deterministic, replay-safe, idempotent.
 *
 * Ownership is preserved: Licensing decides (PDP, `EntitlementPort`/`PolicyPort`), the Feature Registry defines
 * features, Usage measures consumption (`UsageQuotaPort`), Audit owns the trail (`AuditTrail` from
 * `@platform/contracts`). This package owns no business data and depends on no bounded context.
 */
export {
  EntitlementGuard,
  InMemoryEntitlementPort,
  InMemoryPolicyPort,
  InMemoryEntitlementAudit,
} from "./entitlement-guard";
export type {
  EntitlementPort,
  PolicyPort,
  EntitlementRequest,
  EntitlementDecision,
  EntitlementSource,
  EntitlementGuardOptions,
  EntitlementExplanationData,
  EntitlementTelemetry,
  SimulationResult,
} from "./entitlement-guard";
export { explainDecision } from "./explanation";
export type { EntitlementExplanation } from "./explanation";
export { TRACE_STAGES, stageForSource, buildTrace } from "./trace";
export type { DecisionTrace, TraceStep, TraceStage, StageOutput } from "./trace";
export { EntitlementMetrics } from "./metrics";
export type { EntitlementMetricsSnapshot } from "./metrics";
export {
  POLICY_PIPELINE,
  ENTITLEMENT_POLICIES,
  ENFORCEMENT_TARGETS,
  isEntitlementPolicy,
  policyPermits,
} from "./policy";
export type {
  PolicyStage,
  EntitlementPolicy,
  EnforcementAction,
  EnforcementTarget,
} from "./policy";
export { InMemoryUsageQuota, quotaBlocks, DEFAULT_WARNING_THRESHOLD } from "./quota";
export type { UsageQuotaPort, QuotaVerdict, QuotaState, QuotaRequest, QuotaLimit } from "./quota";
export { EntitlementCache } from "./cache";
export type { EntitlementCacheOptions } from "./cache";
