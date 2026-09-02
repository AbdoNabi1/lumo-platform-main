import { ValueObject } from "@platform/domain";

export type RiskBand = "low" | "moderate" | "elevated" | "high";
export type TrustBand = "untrusted" | "low" | "moderate" | "high";

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

interface ScoreProps {
  readonly value: number;
}

/**
 * A **risk score** primitive (0–100, higher = riskier), derived from signals by the `RiskScorer`
 * domain service and fed into the zero-trust decision. Bands give the deterministic thresholds the
 * policy engine and read models share (ADR-0023, sprint Part 6).
 */
export class RiskScore extends ValueObject<ScoreProps> {
  private constructor(props: ScoreProps) {
    super(props);
  }

  static of(value: number): RiskScore {
    return new RiskScore({ value: clamp(value) });
  }

  get value(): number {
    return this.props.value;
  }

  get band(): RiskBand {
    const v = this.props.value;
    if (v < 25) return "low";
    if (v < 50) return "moderate";
    if (v < 75) return "elevated";
    return "high";
  }
}

/**
 * A **trust score** primitive (0–100, higher = more trusted) for a principal/session/device. The
 * mirror of {@link RiskScore}; zero-trust never grants *implicit* trust — trust is always scored.
 */
export class TrustScore extends ValueObject<ScoreProps> {
  private constructor(props: ScoreProps) {
    super(props);
  }

  static of(value: number): TrustScore {
    return new TrustScore({ value: clamp(value) });
  }

  get value(): number {
    return this.props.value;
  }

  get band(): TrustBand {
    const v = this.props.value;
    if (v < 25) return "untrusted";
    if (v < 50) return "low";
    if (v < 75) return "moderate";
    return "high";
  }
}
