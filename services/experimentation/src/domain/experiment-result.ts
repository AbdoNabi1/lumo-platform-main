import { Entity, type UniqueEntityId } from "@platform/domain";

interface ExperimentResultProps {
  readonly variantKey: string;
  readonly metricValue: number;
  readonly sampleSize: number;
  readonly occurredAt: Date;
}

/** An append-only recorded metric observation for one variant (never rewritten). */
export class ExperimentResult extends Entity<ExperimentResultProps> {
  static create(
    id: UniqueEntityId,
    variantKey: string,
    metricValue: number,
    sampleSize: number,
    occurredAt: Date,
  ): ExperimentResult {
    return new ExperimentResult({ variantKey, metricValue, sampleSize, occurredAt }, id);
  }

  get variantKey(): string {
    return this.props.variantKey;
  }

  get metricValue(): number {
    return this.props.metricValue;
  }

  get sampleSize(): number {
    return this.props.sampleSize;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
