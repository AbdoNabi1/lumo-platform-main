import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { FeatureRegistryChanged } from "../domain/events/feature-registry-changed.event";

/** Maps Feature Registry domain events to integration events (carries the canonical `event` name + `aggregate` segment). */
export class FeatureRegistryEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof FeatureRegistryChanged) {
      return {
        type: event.data.event,
        eventVersion: 1,
        aggregateType: event.data.aggregate,
        payload: event.data,
      };
    }
    return undefined;
  }
}

/**
 * The canonical integration events Feature Registry publishes (runtime-verified by `featureRegistryModule`). Every
 * type is `<context>.<aggregate>.<event>`. The Feature Registry owns feature *definitions* only — never feature
 * state, subscriptions, or developer flags.
 */
export const FEATURE_REGISTRY_PUBLISHED_EVENTS = [
  "feature_registry.feature.registered",
  "feature_registry.feature.draft_updated",
  "feature_registry.feature.version_published",
  "feature_registry.feature.revised",
  "feature_registry.feature.deprecated",
  "feature_registry.feature.replaced",
  "feature_registry.feature.removed",
  "feature_registry.feature.group_changed",
  "feature_registry.feature.dependency_changed",
  "feature_registry.bundle.created",
  "feature_registry.bundle.updated",
  "feature_registry.bundle.archived",
] as const;
