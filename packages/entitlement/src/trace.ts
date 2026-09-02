/**
 * Deterministic decision trace (P1.2.1 §3). The trace mirrors the frozen pipeline stages and records, for each,
 * its input, output, explanation and elapsed time. It is a read/observability artifact — building it never changes
 * a verdict. Elapsed times are measured for the phases the guard actually executes (decision / policy / quota) and
 * are `0` for tiers folded inside the decision point (Licensing evaluates them internally).
 */
export const TRACE_STAGES = Object.freeze([
  "platform_override",
  "merchant_override",
  "subscription",
  "feature_definition",
  "dependencies",
  "quota",
  "runtime_flag",
  "final_decision",
] as const);

export type TraceStage = (typeof TRACE_STAGES)[number];

export type StageOutput = "allow" | "deny" | "skip" | "pass";

export interface TraceStep {
  readonly stage: TraceStage;
  readonly input: string;
  readonly output: StageOutput;
  readonly explanation: string;
  readonly elapsedMs: number;
  /** True for the stage that produced the final `source` (the decisive tier). */
  readonly decisive: boolean;
}

export interface DecisionTrace {
  readonly featureKey: string;
  readonly tenant: string;
  readonly decisionId: string;
  readonly allowed: boolean;
  readonly source: string;
  readonly steps: readonly TraceStep[];
  readonly totalElapsedMs: number;
}

/** The minimal decision shape `buildTrace` reads (avoids a runtime import cycle with the guard). */
interface TraceableDecision {
  readonly featureKey: string;
  readonly allowed: boolean;
  readonly source: string;
  readonly decisionId?: string;
  readonly reason?: string;
  readonly quota?: { readonly state: string };
  readonly explain?: {
    readonly missingDependency?: string;
    readonly platformOverride?: string;
    readonly merchantOverride?: string;
    readonly featureFlagStatus?: string;
  };
}

interface TraceableRequest {
  readonly tenant: string;
  readonly resource?: string;
}

/**
 * Builds the deterministic 8-stage trace for a decision (P1.2.1 §3). The decisive stage (mapped from `source`)
 * carries the measured `decideMs` and the final verdict; the other stages report `pass`/`skip` with their known
 * signal. Deterministic: the same decision always yields the same trace.
 */
export function buildTrace(
  request: TraceableRequest,
  decision: TraceableDecision,
  decideMs: number,
): DecisionTrace {
  const decisive = stageForSource(decision.source);
  const verdict: StageOutput = decision.allowed ? "allow" : "deny";
  const e = decision.explain;

  const outputs: Record<TraceStage, { output: StageOutput; input: string; explanation: string }> = {
    platform_override: {
      output:
        e?.platformOverride === undefined
          ? "skip"
          : e.platformOverride === "enabled"
            ? "allow"
            : "deny",
      input: `tenant=${request.tenant}`,
      explanation: e?.platformOverride ?? "no platform override",
    },
    merchant_override: {
      output:
        e?.merchantOverride === undefined
          ? "skip"
          : e.merchantOverride === "enabled"
            ? "allow"
            : "deny",
      input: `tenant=${request.tenant}`,
      explanation: e?.merchantOverride ?? "no merchant override",
    },
    subscription: {
      output: "pass",
      input: `feature=${decision.featureKey}`,
      explanation: "subscription entitlement",
    },
    feature_definition: {
      output:
        decision.source === "feature_unavailable" || decision.source === "feature_unknown"
          ? "deny"
          : "pass",
      input: `feature=${decision.featureKey}`,
      explanation: "feature availability",
    },
    dependencies: {
      output: e?.missingDependency === undefined ? "pass" : "deny",
      input: `feature=${decision.featureKey}`,
      explanation:
        e?.missingDependency !== undefined
          ? `missing ${e.missingDependency}`
          : "dependencies satisfied",
    },
    quota: {
      output:
        request.resource === undefined
          ? "skip"
          : decision.source === "quota_exceeded"
            ? "deny"
            : "pass",
      input: request.resource ?? "none",
      explanation: decision.quota?.state ?? "no quota",
    },
    runtime_flag: {
      output:
        e?.featureFlagStatus === undefined
          ? "skip"
          : e.featureFlagStatus === "off"
            ? "deny"
            : "pass",
      input: `feature=${decision.featureKey}`,
      explanation: e?.featureFlagStatus ?? "no flag",
    },
    final_decision: {
      output: verdict,
      input: `feature=${decision.featureKey}`,
      explanation: decision.reason ?? verdict,
    },
  };

  const steps: TraceStep[] = TRACE_STAGES.map((stage) => {
    const isDecisive = stage === decisive || stage === "final_decision";
    const o = outputs[stage];
    return {
      stage,
      input: o.input,
      output: stage === "final_decision" ? verdict : o.output,
      explanation: o.explanation,
      elapsedMs: stage === decisive ? decideMs : 0,
      decisive: isDecisive,
    };
  });

  return {
    featureKey: decision.featureKey,
    tenant: request.tenant,
    decisionId: decision.decisionId ?? "",
    allowed: decision.allowed,
    source: decision.source,
    steps,
    totalElapsedMs: decideMs,
  };
}

/** Which trace stage a decision `source` maps to (the decisive tier). */
export function stageForSource(source: string): TraceStage {
  switch (source) {
    case "platform_emergency_override":
    case "platform_override":
      return "platform_override";
    case "merchant_override":
      return "merchant_override";
    case "plan":
    case "none":
    case "subscription":
      return "subscription";
    case "feature_unavailable":
    case "feature_unknown":
      return "feature_definition";
    case "quota_exceeded":
      return "quota";
    case "flag_gate":
    case "runtime_flag":
      return "runtime_flag";
    case "policy_denied":
    case "guard_error":
    case "audit_failure":
    default:
      return "final_decision";
  }
}
