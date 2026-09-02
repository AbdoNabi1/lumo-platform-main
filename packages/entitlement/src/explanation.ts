import type { EntitlementDecision } from "./entitlement-guard";
import type { EnforcementAction } from "./policy";

/**
 * The deterministic **read model** for a decision (P1.2.1 §1). It is a pure projection of the decision + its
 * optional explanation signals — it contains no business logic and never re-evaluates anything. Every field is
 * present (defaulted) so consumers (Platform Console, SDK `why()`, AI) get a stable shape.
 */
export interface EntitlementExplanation {
  readonly featureKey: string;
  readonly decision: "allow" | "deny";
  readonly reason: string;
  readonly source: string;
  readonly policy: string;
  readonly action: EnforcementAction;
  readonly requiredPlan: string | null;
  readonly currentPlan: string | null;
  readonly missingCapability: string | null;
  readonly missingDependency: string | null;
  readonly quotaStatus: string | null;
  readonly merchantOverride: string | null;
  readonly platformOverride: string | null;
  readonly featureFlagStatus: string | null;
  readonly evaluatedAt: string;
  readonly decisionId: string;
}

/** Projects a decision into the explanation read model. Pure and deterministic; adds < 1ms (P1.2.1 §10). */
export function explainDecision(
  decision: EntitlementDecision,
  action: EnforcementAction,
  evaluatedAt: string,
): EntitlementExplanation {
  const e = decision.explain;
  return {
    featureKey: decision.featureKey,
    decision: decision.allowed ? "allow" : "deny",
    reason: decision.reason ?? (decision.allowed ? "entitled" : "not entitled"),
    source: decision.source,
    policy: decision.policy ?? "allow",
    action,
    requiredPlan: e?.requiredPlan ?? null,
    currentPlan: e?.currentPlan ?? null,
    missingCapability: e?.missingCapability ?? null,
    missingDependency: e?.missingDependency ?? null,
    quotaStatus: decision.quota?.state ?? null,
    merchantOverride: e?.merchantOverride ?? null,
    platformOverride: e?.platformOverride ?? null,
    featureFlagStatus: e?.featureFlagStatus ?? null,
    evaluatedAt,
    decisionId: decision.decisionId ?? "",
  };
}
