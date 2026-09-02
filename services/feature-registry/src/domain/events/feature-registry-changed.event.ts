import { DomainEvent, type DomainEventProps } from "@platform/domain";

/** The canonical integration-event names Feature Registry publishes — each a 3-segment `<context>.<aggregate>.<event>`. */
export type FeatureRegistryEventName =
  | "feature_registry.feature.registered"
  | "feature_registry.feature.draft_updated"
  | "feature_registry.feature.version_published"
  | "feature_registry.feature.revised"
  | "feature_registry.feature.deprecated"
  | "feature_registry.feature.replaced"
  | "feature_registry.feature.removed"
  | "feature_registry.feature.group_changed"
  | "feature_registry.feature.dependency_changed"
  | "feature_registry.bundle.created"
  | "feature_registry.bundle.updated"
  | "feature_registry.bundle.archived";

export type FeatureRegistryAggregate = "feature" | "bundle";

export interface FeatureRegistryChangedData {
  readonly aggregateId: string;
  readonly aggregate: FeatureRegistryAggregate;
  readonly key: string;
  readonly event: FeatureRegistryEventName;
  readonly lifecycle: string;
  readonly publishedVersion: number | null;
}

/**
 * Raised on every validated Feature Registry fact (registration, draft edits, version publish, deprecation,
 * replacement, soft removal). The translator maps it to the canonical `event` type it carries. PII-free,
 * tenant-aware, outbox. The Feature Registry owns feature *definitions* only — never feature state, subscriptions,
 * or developer flags.
 */
export class FeatureRegistryChanged extends DomainEvent {
  readonly eventName = "feature_registry.changed";
  readonly data: FeatureRegistryChangedData;

  constructor(props: DomainEventProps, data: FeatureRegistryChangedData) {
    super(props);
    this.data = data;
  }
}
