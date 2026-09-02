import type { RiskBand } from "./value-objects/scores";
import type { MfaRequirement } from "./value-objects/auth-method";

/**
 * The context an MFA decision is made in (sprint P2.0-B §2). Assembled by the application layer from
 * the tenant profile, the principal's enrollments, device trust and the Risk Engine's band.
 */
export interface MfaDecisionContext {
  readonly tenantMfaRequired: boolean;
  readonly hasActiveEnrollment: boolean;
  readonly deviceTrusted: boolean;
  readonly rememberDevice: boolean;
  readonly riskBand: RiskBand;
  readonly sensitiveAction: boolean;
}

export interface MfaDecision {
  readonly requirement: MfaRequirement;
  readonly reasons: readonly string[];
}

const RANK: Readonly<Record<MfaRequirement, number>> = {
  step_up: 3,
  required: 2,
  optional: 1,
  none: 0,
};

/**
 * The **MFA Engine** — decides the MFA requirement for a request (sprint P2.0-B §2). Supports
 * required/optional MFA, **adaptive** MFA (elevated/high risk forces MFA), **step-up** (sensitive
 * actions or high risk demand a fresh factor even on a trusted device), and **remember-device** (a
 * trusted device at low risk skips MFA). Pure and deterministic — the strongest applicable
 * requirement wins.
 */
export class MfaEngine {
  decide(ctx: MfaDecisionContext): MfaDecision {
    const candidates: { requirement: MfaRequirement; reason: string }[] = [];

    if (ctx.sensitiveAction)
      candidates.push({ requirement: "step_up", reason: "sensitive action requires step-up" });
    if (ctx.riskBand === "high" || ctx.riskBand === "elevated")
      candidates.push({ requirement: "step_up", reason: `adaptive: ${ctx.riskBand} risk` });
    if (ctx.tenantMfaRequired)
      candidates.push({ requirement: "required", reason: "tenant policy requires MFA" });
    if (ctx.deviceTrusted && ctx.rememberDevice && !ctx.tenantMfaRequired) {
      candidates.push({ requirement: "none", reason: "trusted remembered device" });
    }
    if (candidates.length === 0)
      candidates.push({ requirement: "optional", reason: "MFA available but not required" });

    // A principal with no active enrollment cannot step-up/satisfy required beyond enrolling.
    const strongest = candidates.reduce(
      (best, c) => (RANK[c.requirement] > RANK[best.requirement] ? c : best),
      candidates[0] as { requirement: MfaRequirement; reason: string },
    );
    const reasons = candidates
      .filter((c) => c.requirement === strongest.requirement)
      .map((c) => c.reason);
    if (
      !ctx.hasActiveEnrollment &&
      (strongest.requirement === "step_up" || strongest.requirement === "required")
    ) {
      return {
        requirement: "required",
        reasons: [...reasons, "no active enrollment — enrollment required"],
      };
    }
    return { requirement: strongest.requirement, reasons };
  }
}
