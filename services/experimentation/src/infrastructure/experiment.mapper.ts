import { UniqueEntityId } from "@platform/domain";
import { Experiment } from "../domain/experiment";
import { ExperimentResult } from "../domain/experiment-result";
import {
  ExperimentStatus,
  type ExperimentStatusValue,
} from "../domain/value-objects/experiment-status";
import { ExperimentAudience, Variant } from "../domain/value-objects/variant";

export interface VariantJson {
  readonly key: string;
  readonly allocationPercentage: number;
  readonly isControl: boolean;
}
export interface ExperimentResultJson {
  readonly id: string;
  readonly variantKey: string;
  readonly metricValue: number;
  readonly sampleSize: number;
  readonly occurredAt: string;
}

export interface ExperimentRow {
  readonly id: string;
  readonly name: string;
  readonly hypothesis: string | null;
  readonly variants: readonly VariantJson[];
  readonly audiencePercentage: number;
  readonly audienceSegmentRefs: readonly string[] | null;
  readonly goalMetricRef: string;
  readonly featureFlagRef: string | null;
  readonly status: string;
  readonly results: readonly ExperimentResultJson[];
  readonly winnerVariantKey: string | null;
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link Experiment}. Mapping only — no I/O. */
export class ExperimentMapper {
  static toDomain(row: ExperimentRow): Experiment {
    const variants = row.variants.map((v) => {
      const variant = Variant.create(v.key, v.allocationPercentage, v.isControl);
      if (!variant.ok)
        throw new Error(`Corrupt experiment row: invalid variant (${variant.error.message})`);
      return variant.value;
    });

    return Experiment.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      variants,
      ExperimentAudience.create(row.audiencePercentage, row.audienceSegmentRefs ?? undefined),
      row.goalMetricRef,
      ExperimentStatus.from(row.status as ExperimentStatusValue),
      row.version,
      {
        hypothesis: row.hypothesis ?? undefined,
        featureFlagRef: row.featureFlagRef ?? undefined,
        results: row.results.map((r) =>
          ExperimentResult.create(
            UniqueEntityId.from(r.id),
            r.variantKey,
            r.metricValue,
            r.sampleSize,
            new Date(r.occurredAt),
          ),
        ),
        winnerVariantKey: row.winnerVariantKey ?? undefined,
      },
    );
  }

  static toRow(experiment: Experiment, tenantId: string) {
    return {
      id: experiment.id.toString(),
      tenantId,
      name: experiment.name,
      hypothesis: experiment.hypothesis ?? null,
      variants: experiment.variants.map((v) => ({
        key: v.key,
        allocationPercentage: v.allocationPercentage,
        isControl: v.isControl,
      })),
      audiencePercentage: experiment.audience.percentage,
      audienceSegmentRefs: experiment.audience.segmentRefs ?? null,
      goalMetricRef: experiment.goalMetricRef,
      featureFlagRef: experiment.featureFlagRef ?? null,
      status: experiment.status.value,
      results: experiment.results.map((r) => ({
        id: r.id.toString(),
        variantKey: r.variantKey,
        metricValue: r.metricValue,
        sampleSize: r.sampleSize,
        occurredAt: r.occurredAt.toISOString(),
      })),
      winnerVariantKey: experiment.winnerVariantKey ?? null,
      version: 1,
    };
  }
}
