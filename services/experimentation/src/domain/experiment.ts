import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { ExperimentTransitioned } from "./events/experiment-transitioned.event";
import { ExperimentResult } from "./experiment-result";
import {
  canTransitionExperiment,
  ExperimentStatus,
  type ExperimentStatusValue,
} from "./value-objects/experiment-status";
import type { ExperimentAudience, Variant } from "./value-objects/variant";

interface ExperimentProps {
  readonly name: string;
  readonly hypothesis?: string;
  readonly variants: readonly Variant[];
  readonly audience: ExperimentAudience;
  readonly goalMetricRef: string;
  readonly featureFlagRef?: string;
  status: ExperimentStatus;
  readonly results: ExperimentResult[];
  winnerVariantKey?: string;
}

/**
 * Source of truth for one experiment's lifecycle and results (Sprint 5.3). Analysis only — rollout
 * is owned by Feature Flags (`featureFlagRef` is a bare reference, never a duplicate flag).
 */
export class Experiment extends AggregateRoot<ExperimentProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    variants: readonly Variant[],
    audience: ExperimentAudience,
    goalMetricRef: string,
    hypothesis?: string,
    featureFlagRef?: string,
  ): Experiment {
    return new Experiment(
      {
        name,
        hypothesis,
        variants,
        audience,
        goalMetricRef,
        featureFlagRef,
        status: ExperimentStatus.draft(),
        results: [],
      },
      id,
    );
  }

  /** Rebuilds a persisted experiment exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    name: string,
    variants: readonly Variant[],
    audience: ExperimentAudience,
    goalMetricRef: string,
    status: ExperimentStatus,
    version: number,
    extra: {
      readonly hypothesis?: string;
      readonly featureFlagRef?: string;
      readonly results?: readonly ExperimentResult[];
      readonly winnerVariantKey?: string;
    } = {},
  ): Experiment {
    return new Experiment(
      {
        name,
        hypothesis: extra.hypothesis,
        variants,
        audience,
        goalMetricRef,
        featureFlagRef: extra.featureFlagRef,
        status,
        results: extra.results === undefined ? [] : [...extra.results],
        winnerVariantKey: extra.winnerVariantKey,
      },
      id,
      version,
    );
  }

  /**
   * The generic, validated status transition. `running` is reached two ways with distinct action
   * names: `draft→running` is `started`, `paused→running` is `resumed`.
   */
  transition(toStatus: ExperimentStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionExperiment(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition experiment from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = ExperimentStatus.from(toStatus);
    const action =
      toStatus === "running" ? (fromStatus === "paused" ? "resumed" : "started") : toStatus;
    this.raise("experiment", action, eventId, occurredAt);
  }

  start(eventId: string, occurredAt: Date): void {
    this.transition("running", eventId, occurredAt);
  }

  pause(eventId: string, occurredAt: Date): void {
    this.transition("paused", eventId, occurredAt);
  }

  resume(eventId: string, occurredAt: Date): void {
    this.transition("running", eventId, occurredAt);
  }

  complete(eventId: string, occurredAt: Date): void {
    this.transition("completed", eventId, occurredAt);
  }

  archive(eventId: string, occurredAt: Date): void {
    this.transition("archived", eventId, occurredAt);
  }

  /** Records a metric observation for a variant. */
  recordResult(
    variantKey: string,
    metricValue: number,
    sampleSize: number,
    eventId: string,
    occurredAt: Date,
  ): void {
    if (!this.props.variants.some((v) => v.key === variantKey)) {
      throw new BusinessRuleError(`Unknown variant "${variantKey}"`);
    }
    this.props.results.push(
      ExperimentResult.create(
        UniqueEntityId.from(this.id.toString() + this.props.results.length),
        variantKey,
        metricValue,
        sampleSize,
        occurredAt,
      ),
    );
    this.raise("result", "recorded", eventId, occurredAt, variantKey);
  }

  /** Declares the winning variant. */
  declareWinner(variantKey: string, eventId: string, occurredAt: Date): void {
    if (!this.props.variants.some((v) => v.key === variantKey)) {
      throw new BusinessRuleError(`Unknown variant "${variantKey}"`);
    }
    this.props.winnerVariantKey = variantKey;
    this.raise("winner", "declared", eventId, occurredAt, variantKey);
  }

  private raise(
    family: "experiment" | "result" | "winner",
    action: string,
    eventId: string,
    occurredAt: Date,
    variantKey?: string,
  ): void {
    this.addDomainEvent(
      new ExperimentTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          name: this.props.name,
          family,
          action,
          variantKey,
        },
      ),
    );
  }

  get name(): string {
    return this.props.name;
  }

  get hypothesis(): string | undefined {
    return this.props.hypothesis;
  }

  get variants(): readonly Variant[] {
    return this.props.variants;
  }

  get audience(): ExperimentAudience {
    return this.props.audience;
  }

  get goalMetricRef(): string {
    return this.props.goalMetricRef;
  }

  get featureFlagRef(): string | undefined {
    return this.props.featureFlagRef;
  }

  get status(): ExperimentStatus {
    return this.props.status;
  }

  get results(): readonly ExperimentResult[] {
    return this.props.results;
  }

  get winnerVariantKey(): string | undefined {
    return this.props.winnerVariantKey;
  }
}
