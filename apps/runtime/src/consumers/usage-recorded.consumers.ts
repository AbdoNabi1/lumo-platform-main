import { requireEnvelopeTenant, type IntegrationEvent } from "@platform/domain-events";
import {
  KafkaMessageProducer,
  type MessagingMetrics,
  type SupervisedConsumer,
} from "@platform/kafka";
import type { EventHandler } from "@platform/messaging";
import { isValidUsageRecord, normalizeUsageRecord, type UsageRecord } from "@platform/usage";
import type { RuntimeCore } from "../composition";
import { buildProcessedConsumer } from "../security/consumer-runtime";

/** The canonical wire event every producer publishes (`@platform/usage`'s `PLATFORM_USAGE_EVENT`). */
export const PLATFORM_USAGE_RECORDED = "platform.usage.recorded";

/**
 * The kernel's inbox group for this consumer (`buildProcessedConsumer` keys its own marker in
 * `platform.inbox_processed_events` by `(consumerGroup, messageId)`).
 *
 * It MUST differ from Licensing's `USAGE_RECORD_CONSUMER_GROUP` (`licensing.usage-record`), the key
 * `RecordUsage` writes its own marker under, in the same table, for the same message id. Sharing one
 * key would fuse two independent mechanisms: the kernel's `has` pre-check would read `RecordUsage`'s
 * marker, and were this consumer ever given a `unitOfWork` the kernel's `recordIfNew` would always
 * lose the insert to it. `usage-recorded.consumers.test.ts` pins the two names apart — against the
 * consumer group the built runtime actually uses, not just against this constant.
 */
export const USAGE_RECORDED_CONSUMER_GROUP = "licensing.usage-recorded-consumer";

/** What the consumer needs from Licensing — `LicensingController` satisfies it structurally. */
export interface UsageRecordWriter {
  recordUsage(input: {
    readonly recordId: string;
    readonly tenantRef: string;
    readonly tenantId: string;
    readonly resource: string;
    readonly amount: number;
    readonly unit: string;
    readonly occurredAt: Date;
  }): Promise<{ readonly status: number; readonly body: unknown }>;
}

/**
 * G-79 link 2: consumes `platform.usage.recorded` into Licensing's `UsageCounter`.
 *
 * **Self-idempotent, so it gets no `unitOfWork`** (compare the three `orders.order.paid` consumers, and
 * unlike `finance-settlement.consumers.ts`, whose ledger append is not idempotent): `RecordUsage` owns
 * its dedup INSIDE its own transaction, writing the marker with the counter, keyed by this event's
 * `messageId`. Redelivery is therefore safe without the kernel's atomic path.
 *
 * **Tenant.** The counter is merchant-scoped: `GetUsageCounter` finds it by `(tenantRef, resource,
 * tenantId)`, with `tenantId` taken from the READER's tenant. So the record's tenant is written as
 * BOTH `tenantRef` and `tenantId`, or the merchant's own read would never find what was written
 * (precedent for tenant -> `tenantRef`: `licensing-entitlement.adapter.ts`). That tenant comes from
 * the envelope (G-64, ADR-0014); a payload naming a different one is refused, not trusted.
 *
 * **Every failure THROWS**, so the message goes to retry and then the DLQ and is never acked as done:
 * a missing or disagreeing tenant, an invalid record, and a refusal from Licensing (a record in a
 * different unit than the counter holds, for one). A refused record leaves no marker behind, so its
 * retry is re-attempted rather than swallowed as a duplicate.
 */
export class LicensingUsageRecordedConsumer implements EventHandler<UsageRecord> {
  readonly eventType = PLATFORM_USAGE_RECORDED;
  readonly eventVersion = 1;
  private readonly licensing: UsageRecordWriter;

  constructor(licensing: UsageRecordWriter) {
    this.licensing = licensing;
  }

  async handle(event: IntegrationEvent<UsageRecord>): Promise<void> {
    const tenant = requireEnvelopeTenant(event, "LicensingUsageRecordedConsumer");
    const record = event.payload;
    const occurredAt = new Date(record.occurredAt);
    if (!isValidUsageRecord(record) || Number.isNaN(occurredAt.getTime())) {
      throw new Error(
        `LicensingUsageRecordedConsumer: invalid usage record on message ${event.messageId}`,
      );
    }
    const normalized = normalizeUsageRecord(record);
    if (normalized.tenant !== tenant) {
      throw new Error(
        `LicensingUsageRecordedConsumer: message ${event.messageId} envelope tenant and payload ` +
          "tenant disagree — refusing to credit either",
      );
    }

    const response = await this.licensing.recordUsage({
      recordId: event.messageId,
      tenantRef: tenant,
      tenantId: tenant,
      resource: normalized.resource,
      amount: normalized.amount,
      unit: normalized.unit,
      occurredAt,
    });
    if (response.status >= 300) {
      throw new Error(
        `LicensingUsageRecordedConsumer: Licensing refused usage record ${event.messageId} ` +
          `with status ${response.status}${errorCode(response.body)}`,
      );
    }
  }
}

function errorCode(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body)) return "";
  const { error } = body;
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  const { code } = error;
  return typeof code === "string" ? ` (${code})` : "";
}

/**
 * The `platform.usage.recorded` -> Licensing consumer (G-79 link 2), through `buildProcessedConsumer`
 * for the standard reliability envelope (inbox marker, retry topics, DLQ topic + row) and WITHOUT a
 * `unitOfWork` — see {@link LicensingUsageRecordedConsumer}. Composed over the runtime's own Prisma
 * Licensing (`core.licensing`), so `RecordUsage` uses the durable processed-record store.
 */
export function buildUsageRecordedConsumerRuntimes(
  core: RuntimeCore,
  metrics?: MessagingMetrics,
): readonly SupervisedConsumer[] {
  const producer = new KafkaMessageProducer(core.kafka);
  return [
    buildProcessedConsumer<UsageRecord>(
      core,
      new LicensingUsageRecordedConsumer(core.licensing.licensing),
      USAGE_RECORDED_CONSUMER_GROUP,
      producer,
      metrics,
    ),
  ];
}
