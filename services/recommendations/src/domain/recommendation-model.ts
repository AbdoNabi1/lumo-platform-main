import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { ModelTransitioned } from "./events/model-transitioned.event";
import type { RecommendationStrategy } from "./value-objects/recommendation-strategy";
import { RecommendationSet, type ScoredProductRef } from "./value-objects/recommendation-set";
import {
  canTransitionModel,
  ModelStatus,
  type ModelStatusValue,
} from "./value-objects/model-status";

interface RecommendationModelProps {
  readonly name: string;
  readonly strategy: RecommendationStrategy;
  status: ModelStatus;
  sets: RecommendationSet[];
}

/**
 * Source of truth for one recommendation model's lifecycle and generated sets (Sprint 5.2). Owns no
 * products — relationship sets only (Catalog refs), computed over the shared Search index
 * (`SearchQueryPort`). Event-driven generation is replay-safe via `ProcessedInteractionStore` at the
 * application layer; `regenerate` is idempotent by anchor (overwrites the prior set for that anchor).
 */
export class RecommendationModel extends AggregateRoot<RecommendationModelProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    strategy: RecommendationStrategy,
  ): RecommendationModel {
    return new RecommendationModel({ name, strategy, status: ModelStatus.draft(), sets: [] }, id);
  }

  /** Rebuilds a persisted model exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    name: string,
    strategy: RecommendationStrategy,
    status: ModelStatus,
    version: number,
    sets: readonly RecommendationSet[] = [],
  ): RecommendationModel {
    return new RecommendationModel({ name, strategy, status, sets: [...sets] }, id, version);
  }

  /** The generic, validated status transition — every named method below delegates to this. */
  transition(toStatus: ModelStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionModel(fromStatus, toStatus)) {
      throw new BusinessRuleError(`Cannot transition model from "${fromStatus}" to "${toStatus}"`);
    }
    this.props.status = ModelStatus.from(toStatus);
    this.raise("model", toStatus, eventId, occurredAt);
  }

  startTraining(eventId: string, occurredAt: Date): void {
    this.transition("training", eventId, occurredAt);
  }

  activate(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt);
  }

  retire(eventId: string, occurredAt: Date): void {
    this.transition("retired", eventId, occurredAt);
  }

  /** Generates a set for a new anchor — idempotent (a repeat call for an anchor that already has a set is a no-op; use `regenerate` to force). */
  generate(
    anchorRef: string,
    scoredRefs: readonly ScoredProductRef[],
    eventId: string,
    occurredAt: Date,
  ): void {
    this.requireActive();
    if (this.findSet(anchorRef) !== undefined) return;
    this.props.sets.push(RecommendationSet.create(anchorRef, scoredRefs, occurredAt));
    this.raise("set", "generated", eventId, occurredAt, anchorRef);
  }

  /** Regenerates (overwrites) the set for an anchor — idempotent by anchor. */
  regenerate(
    anchorRef: string,
    scoredRefs: readonly ScoredProductRef[],
    eventId: string,
    occurredAt: Date,
  ): void {
    this.requireActive();
    this.props.sets = this.props.sets.filter((set) => set.anchorRef !== anchorRef);
    this.props.sets.push(RecommendationSet.create(anchorRef, scoredRefs, occurredAt));
    this.raise("set", "regenerated", eventId, occurredAt, anchorRef);
  }

  private findSet(anchorRef: string): RecommendationSet | undefined {
    return this.props.sets.find((set) => set.anchorRef === anchorRef);
  }

  private raise(
    family: "model" | "set",
    action: string,
    eventId: string,
    occurredAt: Date,
    anchorRef?: string,
  ): void {
    this.addDomainEvent(
      new ModelTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          modelName: this.props.name,
          family,
          action,
          anchorRef,
        },
      ),
    );
  }

  private requireActive(): void {
    if (this.props.status.value !== "active") {
      throw new BusinessRuleError(
        `Recommendation model is not active (status: ${this.props.status.value})`,
      );
    }
  }

  get name(): string {
    return this.props.name;
  }

  get strategy(): RecommendationStrategy {
    return this.props.strategy;
  }

  get status(): ModelStatus {
    return this.props.status;
  }

  get sets(): readonly RecommendationSet[] {
    return this.props.sets;
  }
}
