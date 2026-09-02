/**
 * @platform/usage — the canonical, Licensing-agnostic usage-metering contract (ADR-0018 addendum §C).
 * Any bounded context emits `platform.usage.recorded`; Licensing/Billing/Analytics/AI consume it. No producer
 * knows any consumer.
 */
export { USAGE_RESOURCES, isRegisteredResource } from "./usage-resource";
export type { UsageResource } from "./usage-resource";
export {
  UsageResourceRegistry,
  usageResourceRegistry,
  USAGE_METRIC_TYPES,
  isUsageMetricType,
} from "./usage-registry";
export type { UsageResourceDefinition, UsageCategory, UsageMetricType } from "./usage-registry";
export type { UsageRecord } from "./usage-record";
export { isValidUsageRecord, normalizeUsageRecord } from "./usage-record";
export { UsageRecorded, PLATFORM_USAGE_EVENT } from "./usage-recorded.event";
export { UsageEventTranslator, PLATFORM_USAGE_PUBLISHED_EVENTS } from "./usage-event-translator";
export { OutboxUsageRecorder, InMemoryUsageRecorder } from "./usage-recorder.port";
export type { UsageRecorderPort, OutboxUsageRecorderDeps } from "./usage-recorder.port";
