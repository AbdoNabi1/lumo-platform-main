/**
 * Runtime entitlement policies + the **immutable** policy-evaluation pipeline (P1.2 §2/§4).
 *
 * The pipeline order is frozen and introspectable. It is a *declaration* of the order in which the tiers are
 * consulted — the tiers themselves are evaluated by their owners (Licensing's `EntitlementResolver` is the Policy
 * **Decision** Point for override/subscription tiers; the Feature Registry supplies the feature-definition tier;
 * Feature Flags supply the runtime-flag tier). This kernel is the Policy **Enforcement** Point: it never
 * re-implements a tier, it orders, applies policy, meters, caches, audits and enforces.
 */
export const POLICY_PIPELINE = Object.freeze([
  "platform_override",
  "merchant_override",
  "subscription",
  "feature_definition",
  "runtime_flag",
] as const);

export type PolicyStage = (typeof POLICY_PIPELINE)[number];

/** The runtime policy a tenant holds for a feature (P1.2 §4). Metadata-driven; resolved by Licensing. */
export type EntitlementPolicy =
  | "allow"
  | "deny"
  | "read_only"
  | "limited"
  | "trial"
  | "grace_period"
  | "expired"
  | "suspended"
  | "internal"
  | "preview";

export const ENTITLEMENT_POLICIES: readonly EntitlementPolicy[] = [
  "allow",
  "deny",
  "read_only",
  "limited",
  "trial",
  "grace_period",
  "expired",
  "suspended",
  "internal",
  "preview",
];

export function isEntitlementPolicy(value: string): value is EntitlementPolicy {
  return (ENTITLEMENT_POLICIES as readonly string[]).includes(value);
}

/** The kind of access being attempted. `read_only` permits `read` and denies `write`. */
export type EnforcementAction = "read" | "write";

/** Where enforcement is applied (P1.2 §3/§11/§12/§13). One guard, many call sites — never duplicated logic. */
export type EnforcementTarget =
  | "command"
  | "api"
  | "graphql"
  | "admin_action"
  | "background_job"
  | "workflow"
  | "scheduled_task"
  | "ai_request"
  | "marketplace_operation"
  | "sdk"
  | "cli";

export const ENFORCEMENT_TARGETS: readonly EnforcementTarget[] = [
  "command",
  "api",
  "graphql",
  "admin_action",
  "background_job",
  "workflow",
  "scheduled_task",
  "ai_request",
  "marketplace_operation",
  "sdk",
  "cli",
];

/**
 * Whether a policy permits an action. Deterministic and total — every policy has an explicit verdict, so a new
 * policy cannot silently default to "allow" (fail-closed by construction).
 */
export function policyPermits(policy: EntitlementPolicy, action: EnforcementAction): boolean {
  switch (policy) {
    case "allow":
    case "limited":
    case "trial":
    case "grace_period":
    case "internal":
    case "preview":
      return true;
    case "read_only":
      return action === "read";
    case "deny":
    case "expired":
    case "suspended":
      return false;
  }
}
