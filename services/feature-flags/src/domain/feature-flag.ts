import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { FlagChange } from "./flag-change";
import { FlagTransitioned } from "./events/flag-transitioned.event";
import type { FeatureEnvironment } from "./value-objects/feature-environment";
import type { FeatureEvaluation, FeatureRule } from "./value-objects/feature-rule";
import { canTransitionFlag, FlagStatus, type FlagStatusValue } from "./value-objects/flag-status";

interface FeatureFlagProps {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  status: FlagStatus;
  environments: FeatureEnvironment[];
  rules: FeatureRule[];
  rolloutPercentage: number;
  readonly changes: FlagChange[];
}

/** FNV-1a — a small, dependency-free, deterministic hash used for percentage-rollout bucketing. */
function fnv1aBucket(subjectId: string, flagKey: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${flagKey}:${subjectId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

/**
 * Source of truth for one feature flag's lifecycle, targeting, and rollout (Sprint 5.3). This is
 * the production implementation the existing `@platform/feature-flags` `FeatureFlags` contract
 * anticipated — extends it, never duplicates it (the contract/`EvaluationContext`/
 * `InMemoryFeatureFlags` stay unmodified; `AggregateFeatureFlags` in infrastructure adapts this
 * aggregate to that interface).
 */
export class FeatureFlag extends AggregateRoot<FeatureFlagProps> {
  static create(id: UniqueEntityId, key: string, name: string, description?: string): FeatureFlag {
    return new FeatureFlag(
      {
        key,
        name,
        description,
        status: FlagStatus.active(),
        environments: [],
        rules: [],
        rolloutPercentage: 0,
        changes: [],
      },
      id,
    );
  }

  /** Rebuilds a persisted flag exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    key: string,
    name: string,
    status: FlagStatus,
    rolloutPercentage: number,
    version: number,
    extra: {
      readonly description?: string;
      readonly environments?: readonly FeatureEnvironment[];
      readonly rules?: readonly FeatureRule[];
      readonly changes?: readonly FlagChange[];
    } = {},
  ): FeatureFlag {
    return new FeatureFlag(
      {
        key,
        name,
        description: extra.description,
        status,
        environments: extra.environments === undefined ? [] : [...extra.environments],
        rules: extra.rules === undefined ? [] : [...extra.rules],
        rolloutPercentage,
        changes: extra.changes === undefined ? [] : [...extra.changes],
      },
      id,
      version,
    );
  }

  /** The generic, validated status transition — every named method below delegates to this. */
  transition(
    toStatus: FlagStatusValue,
    changedBy: string,
    eventId: string,
    occurredAt: Date,
  ): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionFlag(fromStatus, toStatus)) {
      throw new BusinessRuleError(`Cannot transition flag from "${fromStatus}" to "${toStatus}"`);
    }
    this.props.status = FlagStatus.from(toStatus);
    const action = toStatus === "active" ? "revived" : toStatus;
    this.recordChange(action, changedBy, occurredAt);
    this.raise(action, eventId, occurredAt);
  }

  kill(changedBy: string, eventId: string, occurredAt: Date): void {
    this.transition("killed", changedBy, eventId, occurredAt);
  }

  revive(changedBy: string, eventId: string, occurredAt: Date): void {
    this.transition("active", changedBy, eventId, occurredAt);
  }

  archive(changedBy: string, eventId: string, occurredAt: Date): void {
    this.transition("archived", changedBy, eventId, occurredAt);
  }

  setEnvironmentOverride(
    environment: FeatureEnvironment,
    changedBy: string,
    eventId: string,
    occurredAt: Date,
  ): void {
    this.props.environments = [
      ...this.props.environments.filter((e) => e.environment !== environment.environment),
      environment,
    ];
    this.recordChange(
      "rule_updated",
      changedBy,
      occurredAt,
      `environment:${environment.environment}`,
    );
    this.raise("rule_updated", eventId, occurredAt);
  }

  addRule(rule: FeatureRule, changedBy: string, eventId: string, occurredAt: Date): void {
    this.props.rules = [...this.props.rules, rule];
    this.recordChange("rule_updated", changedBy, occurredAt, `rule:${rule.type}`);
    this.raise("rule_updated", eventId, occurredAt);
  }

  setRolloutPercentage(
    percentage: number,
    changedBy: string,
    eventId: string,
    occurredAt: Date,
  ): void {
    if (percentage < 0 || percentage > 100) {
      throw new BusinessRuleError("Rollout percentage must be between 0 and 100");
    }
    this.props.rolloutPercentage = percentage;
    this.recordChange("rollout_changed", changedBy, occurredAt, `${percentage}%`);
    this.raise("rollout_changed", eventId, occurredAt);
  }

  /** Evaluates this flag for a subject — pure, no side effects, no domain event. */
  evaluate(
    subjectId: string,
    environment?: string,
    attributes: Readonly<Record<string, string>> = {},
  ): FeatureEvaluation {
    if (this.props.status.value === "killed") return { enabled: false, reason: "killed" };
    if (this.props.status.value === "archived") return { enabled: false, reason: "archived" };

    for (const rule of this.props.rules) {
      if (rule.matches(subjectId, attributes)) {
        return { enabled: rule.enabled, reason: "rule_match" };
      }
    }

    if (environment !== undefined) {
      const override = this.props.environments.find((e) => e.environment === environment);
      if (override !== undefined && override.rolloutPercentage === undefined) {
        return { enabled: override.enabled, reason: "environment_override" };
      }
      if (override !== undefined && override.rolloutPercentage !== undefined) {
        const enabled =
          override.enabled && fnv1aBucket(subjectId, this.props.key) < override.rolloutPercentage;
        return { enabled, reason: "environment_override" };
      }
    }

    return {
      enabled: fnv1aBucket(subjectId, this.props.key) < this.props.rolloutPercentage,
      reason: "rollout_bucket",
    };
  }

  private recordChange(
    action: FlagChange["action"],
    changedBy: string,
    occurredAt: Date,
    details?: string,
  ): void {
    this.props.changes.push(
      FlagChange.create(
        UniqueEntityId.from(this.id.toString() + this.props.changes.length),
        action,
        changedBy,
        occurredAt,
        details,
      ),
    );
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new FlagTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        { key: this.props.key, action },
      ),
    );
  }

  get key(): string {
    return this.props.key;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string | undefined {
    return this.props.description;
  }

  get status(): FlagStatus {
    return this.props.status;
  }

  get environments(): readonly FeatureEnvironment[] {
    return this.props.environments;
  }

  get rules(): readonly FeatureRule[] {
    return this.props.rules;
  }

  get rolloutPercentage(): number {
    return this.props.rolloutPercentage;
  }

  get changes(): readonly FlagChange[] {
    return this.props.changes;
  }
}
