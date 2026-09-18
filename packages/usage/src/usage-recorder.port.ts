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
    // Normalise once: payload, aggregate id and envelope tenant must be the same string. Note that
    // `isValidUsageRecord` accepts a padded tenant, so reading `record.tenant` raw here would put an
    // untrimmed tenant on the envelope while the payload carried the trimmed one (ADR-0014).
    const normalized = normalizeUsageRecord(record);
    const event = new UsageRecorded(
      {
        eventId: this.deps.idGenerator.generate(),
        aggregateId: UniqueEntityId.from(normalized.tenant),
        occurredAt: this.deps.clock.now(),
      },
      normalized,
    );
    await this.deps.outbox.write(
      [event],
      { ...this.deps.context, tenantId: normalized.tenant },
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
