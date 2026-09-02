import { type PolicyEffect, type PolicyRule, type PolicyVersion } from "./policy";
import { evaluateLeaf } from "./policy-condition";
import { PolicyExpressionEvaluator, type FragmentResolver } from "./policy-expression";
import type { ResourceUrn } from "./value-objects/resource-urn";

/**
 * The signals every request is evaluated on under zero-trust — **no implicit trust**: identity,
 * session, device, risk, policy, permission, environment (ADR-0023 §3). Assembled by the
 * application layer from the principal/session/device/authorization results; the evaluator is pure.
 */
export interface ZeroTrustContext {
  readonly principalActive: boolean;
  readonly sessionValid: boolean;
  /** Result of the RBAC/ABAC authorization check (AuthorizationEvaluator). */
  readonly permissionGranted: boolean;
  readonly deviceTrusted: boolean;
  readonly risk: number;
  readonly trust: number;
  readonly environment: string | null;
  readonly resource: ResourceUrn | null;
}

export interface ZeroTrustDecision {
  readonly effect: PolicyEffect;
  readonly reasons: readonly string[];
  readonly matchedRuleIds: readonly string[];
  readonly policyVersion: number | null;
}

const EFFECT_RANK: Readonly<Record<PolicyEffect, number>> = {
  block: 3,
  challenge: 2,
  review: 1,
  allow: 0,
};

/**
 * The **zero-trust evaluator** (Policy Engine core). Structural gates fail closed first
 * (inactive principal / invalid session / permission not granted ⇒ `block`), then the active
 * immutable {@link PolicyVersion} is applied with **deny-overrides** precedence
 * (`block > challenge > review > allow`, falling back to the version's default effect). Each rule
 * fires on its composable {@link PolicyExpression} (`expr`) when present, else its leaf `when`
 * condition — both via the same shared leaf evaluator. Pure and synchronous by design (ADR-0023 §3).
 */
export class ZeroTrustEvaluator {
  private readonly expressions = new PolicyExpressionEvaluator();

  evaluate(
    context: ZeroTrustContext,
    policyVersion: PolicyVersion | null,
    fragments?: FragmentResolver,
  ): ZeroTrustDecision {
    const version = policyVersion?.version ?? null;

    if (!context.principalActive) return this.blocked("principal is not active", version);
    if (!context.sessionValid) return this.blocked("no valid session", version);
    if (!context.permissionGranted) return this.blocked("permission not granted", version);

    if (policyVersion === null) {
      return {
        effect: "allow",
        reasons: ["gates passed; no active policy"],
        matchedRuleIds: [],
        policyVersion: null,
      };
    }

    const fired: PolicyRule[] = policyVersion.rules.filter((rule) =>
      this.matches(rule, context, fragments),
    );
    const candidates: PolicyEffect[] =
      fired.length > 0 ? fired.map((r) => r.effect) : [policyVersion.defaultEffect];
    const effect = candidates.reduce(
      (strongest, e) => (EFFECT_RANK[e] > EFFECT_RANK[strongest] ? e : strongest),
      "allow" as PolicyEffect,
    );
    const reasons =
      fired.length > 0
        ? fired.map((r) => `${r.id}: ${r.description}`)
        : [`default effect (${policyVersion.defaultEffect})`];
    return { effect, reasons, matchedRuleIds: fired.map((r) => r.id), policyVersion: version };
  }

  private matches(
    rule: PolicyRule,
    context: ZeroTrustContext,
    fragments: FragmentResolver | undefined,
  ): boolean {
    if (rule.expr !== undefined) return this.expressions.evaluate(rule.expr, context, fragments);
    return evaluateLeaf(rule.when, context);
  }

  private blocked(reason: string, version: number | null): ZeroTrustDecision {
    return { effect: "block", reasons: [reason], matchedRuleIds: [], policyVersion: version };
  }
}
