import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import { type DomainError } from "@platform/utils";
import type { RiskBand } from "../domain/value-objects/scores";
import type { RiskEngineSignals, RiskFactor } from "../domain/risk-engine";
import { securityEvent, type SecurityDeps } from "./deps";
import { enrichRiskSignals } from "./risk-helpers";

export interface EvaluateRiskInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly principalExternalId?: string;
  readonly ip?: string;
  readonly deviceFingerprint?: string;
  readonly signals?: RiskEngineSignals;
}

export interface RiskEvaluationOutput {
  readonly score: number;
  readonly band: RiskBand;
  readonly factors: readonly RiskFactor[];
}

/**
 * Evaluates request risk via the {@link RiskEngine}, enriching the caller's signals with geo/ASN/
 * anonymizer data ({@link GeoIpPort}) and the device's reputation. Deterministic and **explainable**
 * — every factor is returned. Emits `security.risk.evaluated` (sprint P2.0-B §4).
 */
export class EvaluateRisk implements UseCase<EvaluateRiskInput, RiskEvaluationOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: EvaluateRiskInput): Promise<Result<RiskEvaluationOutput, DomainError>> {
    const signals = await enrichRiskSignals(
      this.deps,
      {
        ...(input.ip !== undefined ? { ip: input.ip } : {}),
        ...(input.deviceFingerprint !== undefined
          ? { deviceFingerprint: input.deviceFingerprint }
          : {}),
        ...(input.signals !== undefined ? { base: input.signals } : {}),
      },
      input.tenantId,
    );
    const evaluation = this.deps.riskEngine.evaluate(signals);
    this.deps.telemetry.recordRiskBand(evaluation.score.band);
    await this.deps.outbox.publish(
      [
        securityEvent(
          this.deps,
          "risk",
          this.deps.idGenerator.generate(),
          input.principalExternalId ?? "anonymous",
          "security.risk.evaluated",
          evaluation.score.band,
        ),
      ],
      input.tenantId,
    );

    return ok({
      score: evaluation.score.value,
      band: evaluation.score.band,
      factors: evaluation.factors,
    });
  }
}
