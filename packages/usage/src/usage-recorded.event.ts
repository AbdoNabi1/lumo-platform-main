import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { UsageRecord } from "./usage-record";

/** The canonical integration-event name every producer publishes (3-segment `<context>.<aggregate>.<event>`). */
export const PLATFORM_USAGE_EVENT = "platform.usage.recorded" as const;

/**
 * The generic usage domain event. Producers add it to the outbox; the {@link UsageEventTranslator} maps it to the
 * canonical `platform.usage.recorded` integration event. Deliberately knows nothing about any consumer.
 */
export class UsageRecorded extends DomainEvent {
  readonly eventName = "platform.usage.recorded";
  readonly data: UsageRecord;

  constructor(props: DomainEventProps, data: UsageRecord) {
    super(props);
    this.data = data;
  }
}
