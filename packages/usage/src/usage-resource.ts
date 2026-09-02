/**
 * The canonical `UsageResource` registry (ADR-0018 addendum §I). Producers should emit only **registered**
 * resource types so that Licensing/Billing/Analytics meter a stable, shared vocabulary rather than free text.
 * The set is extensible (add a new member here + its ADR/doc note); the `UsageRecord.resource` field stays a
 * plain string for wire compatibility, but `isRegisteredResource` lets consumers flag unregistered values.
 */
export const USAGE_RESOURCES = [
  "AI_TOKEN",
  "EMAIL",
  "SMS",
  "API_REQUEST",
  "STORAGE",
  "BANDWIDTH",
  "MEDIA",
  "PRODUCT",
  "ORDER",
  "IMPORT",
  "EXPORT",
  "SEARCH",
  "RECOMMENDATION",
  "AUTOMATION",
  "WORKFLOW",
  "IMAGE_RENDER",
  "VIDEO_RENDER",
  "MARKETPLACE_INSTALL",
] as const;

export type UsageResource = (typeof USAGE_RESOURCES)[number];

const REGISTRY = new Set<string>(USAGE_RESOURCES);

/** True when `resource` is a registered canonical usage resource. */
export function isRegisteredResource(resource: string): resource is UsageResource {
  return REGISTRY.has(resource);
}
