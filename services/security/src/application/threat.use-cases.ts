import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import { type DomainError } from "@platform/utils";
import type { ThreatVerdict } from "../domain/threat-intel";
import { recordAudit, securityEvent, type SecurityDeps } from "./deps";

export interface CheckThreatIndicatorInput {
  /** IP / domain / hash / URL. */
  readonly indicator: string;
}

export interface ThreatVerdictOutput {
  readonly indicator: string;
  readonly malicious: boolean;
  readonly score: number;
  readonly categories: readonly string[];
  readonly source: string;
  readonly providers: readonly string[];
}

/**
 * Checks an indicator across every registered threat-intel provider ({@link ThreatIntelResolver}) and
 * aggregates the verdicts (sprint P2.0-E §10). When malicious, records telemetry, emits
 * `security.threat.detected` and a WORM audit record. Providers (Cloudflare/CrowdStrike/…) are
 * pluggable; the aggregation is deterministic.
 */
export class CheckThreatIndicator implements UseCase<
  CheckThreatIndicatorInput,
  ThreatVerdictOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: CheckThreatIndicatorInput,
  ): Promise<Result<ThreatVerdictOutput, DomainError>> {
    const verdicts = await this.deps.threatIntel.lookupAll(input.indicator);
    const verdict: ThreatVerdict = this.deps.threatAggregator.aggregate(input.indicator, verdicts);

    if (verdict.malicious) {
      this.deps.telemetry.increment("security.threat.indicated");
      await this.deps.unitOfWork.run(async (tx) => {
        await this.deps.outbox.publish(
          [
            securityEvent(
              this.deps,
              "threat",
              this.deps.idGenerator.generate(),
              input.indicator,
              "security.threat.detected",
              `score:${verdict.score}`,
            ),
          ],
          tx,
        );
        await recordAudit(this.deps, tx, {
          principalRef: "system",
          action: "security.threat.detected",
          decision: "block",
          metadata: {
            indicator: input.indicator,
            score: String(verdict.score),
            categories: verdict.categories.join(","),
          },
        });
      });
    }

    return ok({
      indicator: verdict.indicator,
      malicious: verdict.malicious,
      score: verdict.score,
      categories: verdict.categories,
      source: verdict.source,
      providers: this.deps.threatIntel.providerNames(),
    });
  }
}
