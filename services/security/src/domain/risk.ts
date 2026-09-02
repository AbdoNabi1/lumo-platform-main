import { RiskScore, TrustScore } from "./value-objects/scores";

/** Observable risk signals for a request/session. All optional; absent ⇒ neutral. */
export interface RiskSignals {
  readonly failedAuthCount?: number;
  readonly newDevice?: boolean;
  readonly impossibleTravel?: boolean;
  readonly threatIntelHit?: boolean;
  /** IP reputation as risk contribution (0 = clean, 100 = known-bad). */
  readonly ipReputation?: number;
}

/** Observable trust signals for a principal/session/device. All optional; absent ⇒ neutral. */
export interface TrustSignals {
  readonly deviceTrusted?: boolean;
  readonly mfaSatisfied?: boolean;
  readonly sessionAgeDays?: number;
  readonly knownGoodPrincipal?: boolean;
}

/**
 * The **risk scoring** primitive — a deterministic, explainable weighting of signals into a
 * {@link RiskScore}. Intentionally simple and pure; adaptive/ML/threat-intel scoring composes on
 * top through ports and async enrichment without changing this contract (ADR-0023, sprint Part 6).
 */
export class RiskScorer {
  score(signals: RiskSignals): RiskScore {
    let risk = 0;
    risk += Math.min(40, (signals.failedAuthCount ?? 0) * 10);
    if (signals.newDevice === true) risk += 15;
    if (signals.impossibleTravel === true) risk += 30;
    if (signals.threatIntelHit === true) risk += 40;
    risk += Math.min(30, Math.max(0, (signals.ipReputation ?? 0) * 0.3));
    return RiskScore.of(risk);
  }
}

/** The **trust scoring** primitive — mirror of {@link RiskScorer}. Zero-trust never assumes trust. */
export class TrustScorer {
  score(signals: TrustSignals): TrustScore {
    let trust = 20;
    if (signals.deviceTrusted === true) trust += 25;
    if (signals.mfaSatisfied === true) trust += 30;
    if (signals.knownGoodPrincipal === true) trust += 15;
    trust += Math.min(10, Math.max(0, signals.sessionAgeDays ?? 0));
    return TrustScore.of(trust);
  }
}
