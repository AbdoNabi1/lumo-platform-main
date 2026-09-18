import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { normalizeUsageRecord, type UsageRecord } from "./usage-record";
import { UsageRecorded } from "./usage-recorded.event";

/**
 * Outbound port a bounded context depends on to record usage **without knowing any consumer**. Implementations
 * publish the canonical `platform.usage.recorded` event; Licensing/Billing/Analytics/AI consume it independently.
 */
export interface UsageRecorderPort {
  record(record: UsageRecord): Promise<void>;
}

export interface OutboxUsageRecorderDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Production `UsageRecorderPort` — writes a {@link UsageRecorded} event to the outbox (translated to the canonical type). */
export class OutboxUsageRecorder implements UsageRecorderPort {
  private readonly deps: OutboxUsageRecorderDeps;

  constructor(deps: OutboxUsageRecorderDeps) {
    this.deps = deps;
  }

  async record(record: UsageRecord): Promise<void> {
    const event = new UsageRecorded(
      {
        eventId: this.deps.idGenerator.generate(),
        aggregateId: UniqueEntityId.from(record.tenant),
        occurredAt: this.deps.clock.now(),
      },
      normalizeUsageRecord(record),
    );
    await this.deps.outbox.write(
      [event],
      { ...this.deps.context, tenantId: record.tenant },
      undefined,
    );
  }
}

/** In-memory `UsageRecorderPort` for tests/dev — captures records in order. */
export class InMemoryUsageRecorder implements UsageRecorderPort {
  readonly records: UsageRecord[] = [];

  async record(record: UsageRecord): Promise<void> {
    this.records.push(normalizeUsageRecord(record));
  }
}
