import { RiskScore } from "./value-objects/scores";

/**
 * Expanded, observable risk inputs for the {@link RiskEngine} (sprint P2.0-B §4). All optional; an
 * absent signal contributes nothing. Values are supplied by ports (geo/ASN/threat-intel/device) — the
 * engine itself is pure and deterministic.
 */
export interface RiskEngineSignals {
  readonly tor?: boolean;
  readonly vpn?: boolean;
  readonly impossibleTravel?: boolean;
  readonly newGeo?: boolean;
  /** Requests per minute for the principal (velocity). */
  readonly velocityPerMin?: number;
  readonly failedAuthCount?: number;
  /** Device reputation 0–100 (higher = better) — low reputation raises risk. */
  readonly deviceReputation?: number;
  /** IP reputation 0–100 (higher = worse). */
  readonly ipReputation?: number;
  /** ASN reputation 0–100 (higher = worse). */
  readonly asnReputation?: number;
  /** Behavioural anomaly 0–100 (higher = worse). */
  readonly behavioralAnomaly?: number;
}

/** One explainable contribution to the score — code, points added, human detail. */
export interface RiskFactor {
  readonly code: string;
  readonly contribution: number;
  readonly detail: string;
}

export interface RiskEvaluation {
  readonly score: RiskScore;
  readonly factors: readonly RiskFactor[];
}

const cap = (value: number, max: number): number => Math.min(max, Math.max(0, value));

/**
 * The **Risk Engine** — turns signals into an explainable {@link RiskScore} (sprint P2.0-B §4).
 * Deterministic and side-effect-free: every point is attributed to a named {@link RiskFactor}, so a
 * decision can always be explained (`explainDecision()` in the SDK). Adaptive/ML scoring layers on
 * later via ports + async enrichment without changing this contract.
 */
export class RiskEngine {
  evaluate(signals: RiskEngineSignals): RiskEvaluation {
    const factors: RiskFactor[] = [];
    const add = (code: string, contribution: number, detail: string): void => {
      if (contribution > 0) factors.push({ code, contribution: Math.round(contribution), detail });
    };

    if (signals.tor === true) add("tor", 35, "connection via Tor exit node");
    if (signals.vpn === true) add("vpn", 10, "anonymizing VPN detected");
    if (signals.impossibleTravel === true)
      add("impossible_travel", 30, "impossible travel between locations");
    if (signals.newGeo === true) add("new_geo", 10, "first login from this region");
    add(
      "velocity",
      cap(((signals.velocityPerMin ?? 0) - 30) * 0.5, 20),
      "elevated request velocity",
    );
    add(
      "failed_auth",
      cap((signals.failedAuthCount ?? 0) * 10, 30),
      "recent failed authentications",
    );
    if (signals.deviceReputation !== undefined)
      add(
        "device_reputation",
        cap((100 - signals.deviceReputation) * 0.15, 15),
        "low device reputation",
      );
    add("ip_reputation", cap((signals.ipReputation ?? 0) * 0.25, 25), "poor IP reputation");
    add("asn_reputation", cap((signals.asnReputation ?? 0) * 0.1, 10), "poor ASN reputation");
    add("behavioral", cap((signals.behavioralAnomaly ?? 0) * 0.2, 20), "behavioural anomaly");

    const total = factors.reduce((sum, f) => sum + f.contribution, 0);
    return { score: RiskScore.of(total), factors };
  }
}
