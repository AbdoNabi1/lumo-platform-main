import type { Logger } from "@platform/utils";
import type { ControllerResponse } from "./presenter";
import type { SecurityController } from "./security.controller";

/**
 * The canonical keys of the baseline security model this bootstrap provisions. Exported so the
 * provisioning consumer + the integration tests reference the SAME identifiers (no magic strings drift).
 */
export const BASELINE_POLICY_KEY = "platform-baseline";
export const PLATFORM_ADMIN_ROLE = "platform-admin";
export const PLATFORM_SERVICE_ROLE = "platform-service";
/** `grantedBy` on every bootstrap/provisioning role grant — the non-human runtime provisioner. */
export const SYSTEM_GRANTOR = "security-runtime";

/** Risk bands the baseline zero-trust policy enforces (0–100 scale, matching the RiskScorer output). */
const RISK_STEP_UP = 60;
const RISK_BLOCK = 85;

/**
 * The enforcement grant the baseline gives a tenant's owner: `(permissions, *:*, granted, <owner>)`.
 * Written through `SecurityController.writeRelationTuple`, which emits `security.relation.written`; the
 * relation-sync consumer then writes the TENANT-QUALIFIED tuple (`tenant/<tenantId>/*:*`, G-70). Nothing
 * here builds the qualified shape, so a bare tuple cannot reappear from this path.
 */
export const OWNER_GRANT = {
  namespace: "permissions",
  object: "*:*",
  relation: "granted",
} as const;

export interface SecurityBootstrapSummary {
  readonly roles: readonly string[];
  readonly policyKey: string;
  readonly tenantRef: string;
}

/** Throws (fail-closed) when a bootstrap step did not succeed — boot must abort, never half-provision. */
function expectOk(response: ControllerResponse, step: string): void {
  if (response.status >= 300) {
    throw new Error(
      `security bootstrap step "${step}" failed (status ${response.status}): ${JSON.stringify(response.body)}`,
    );
  }
}

/**
 * Provisions the **baseline production security model** at startup (P2.0.2 blocker B), reusing the
 * existing `SecurityController` use-cases only — `DefineRole` / `GrantRolePermission` / `DefinePolicy` /
 * `PublishPolicyVersion` / `ConfigureTenantSecurity`. Every step is idempotent (each use-case is
 * upsert-by-key), so it converges safely across replicas and restarts; no authorization is hardcoded in
 * middleware — the policy versions live in the Security store, where the zero-trust evaluator reads them.
 *
 * The baseline is a real **balanced** zero-trust posture, not a rubber stamp: the structural gates
 * (active principal + valid session + granted RBAC/ABAC permission) always apply first (frozen in the
 * evaluator), then this policy **steps up** (challenge) at elevated risk and **blocks** at high risk. It
 * is the floor operators extend via published policy versions — deployment provisioning, not app code.
 */
export async function bootstrapSecurity(
  security: SecurityController,
  tenantId: string,
  logger: Logger,
): Promise<SecurityBootstrapSummary> {
  // 1. Roles — a full-authority human admin role and a read-scoped service role (extend via DefineRole).
  expectOk(
    await security.defineRole({
      tenantId,
      key: PLATFORM_ADMIN_ROLE,
      name: "Platform Administrator",
      permissions: ["*:*"],
    }),
    "defineRole(platform-admin)",
  );
  expectOk(
    await security.defineRole({
      tenantId,
      key: PLATFORM_SERVICE_ROLE,
      name: "Platform Service",
      permissions: ["*:read"],
    }),
    "defineRole(platform-service)",
  );

  // 2. Baseline zero-trust policy (balanced): default-allow once gates pass; step-up then block on risk.
  expectOk(
    await security.definePolicy({
      tenantId,
      key: BASELINE_POLICY_KEY,
      name: "Platform Baseline",
      mode: "balanced",
    }),
    "definePolicy",
  );
  expectOk(
    await security.publishPolicyVersion({
      tenantId,
      key: BASELINE_POLICY_KEY,
      rules: [
        {
          id: "high-risk-block",
          description: "Block when evaluated risk is high",
          when: { minRisk: RISK_BLOCK },
          effect: "block",
        },
        {
          id: "elevated-risk-stepup",
          description: "Step-up (MFA) when evaluated risk is elevated",
          when: { minRisk: RISK_STEP_UP },
          effect: "challenge",
        },
      ],
    }),
    "publishPolicyVersion",
  );

  // 3. Tenant security profile — pins the baseline policy as the tenant's default governing policy.
  expectOk(
    await security.configureTenantSecurity({
      tenantId,
      tenantRef: tenantId,
      config: { securityMode: "balanced", defaultPolicyKey: BASELINE_POLICY_KEY },
    }),
    "configureTenantSecurity",
  );

  const summary: SecurityBootstrapSummary = {
    roles: [PLATFORM_ADMIN_ROLE, PLATFORM_SERVICE_ROLE],
    policyKey: BASELINE_POLICY_KEY,
    tenantRef: tenantId,
  };
  logger.info("security baseline provisioned", {
    roles: summary.roles.join(","),
    policy: summary.policyKey,
    tenant: tenantId,
  });
  return summary;
}
