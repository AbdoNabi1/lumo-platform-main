import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import type { ProcessedUsageRecordStore } from "./application/ports";
import { RecordUsage, type RecordUsageInput } from "./application/licensing.use-cases";
import { LicensingEventTranslator } from "./infrastructure/licensing-event-translator";
import {
  InMemoryProcessedUsageRecordStore,
  InMemoryUsageCounterRepository,
} from "./infrastructure/in-memory-repositories";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-09-29T00:00:00.000Z") };

const input: RecordUsageInput = {
  recordId: "record-1",
  tenantRef: "t-1",
  resource: "PRODUCT",
  amount: 1,
  unit: "count",
  occurredAt: new Date("2026-09-29T00:00:00.000Z"),
  tenantId: "t-1",
};

/** A store that remembers which transaction handle each call was given. */
class TxRecordingStore implements ProcessedUsageRecordStore {
  readonly seen = new Set<string>();
  readonly txs: unknown[] = [];

  async hasProcessed(recordId: string, tx?: unknown): Promise<boolean> {
    this.txs.push(tx);
    return this.seen.has(recordId);
  }

  async markProcessed(recordId: string, tx?: unknown): Promise<void> {
    this.txs.push(tx);
    this.seen.add(recordId);
  }
}

function build(store: ProcessedUsageRecordStore, tx: unknown) {
  const idGenerator = sequentialIds();
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new LicensingEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "licensing",
  });
  const usageCounters = new InMemoryUsageCounterRepository({
    outbox,
    context: rootEventContext(idGenerator),
  });
  const recordUsage = new RecordUsage({
    plans: undefined as never,
    subscriptions: undefined as never,
    merchantFeatureOverrides: undefined as never,
    merchantCapabilities: undefined as never,
    usageCounters,
    processedUsageRecords: store,
    unitOfWork: { run: (work) => work(tx) },
    idGenerator,
    clock,
  });
  return { recordUsage, usageCounters };
}

describe("RecordUsage replay safety", () => {
  it("hands its own transaction to the processed-record store, so marker and counter commit together", async () => {
    // With a Prisma store the marker is an INSERT; if it ran on the base client instead of `tx`, a
    // crash between the counter commit and the marker would let a redelivery count twice.
    const tx = { marker: "the-record-usage-transaction" };
    const store = new TxRecordingStore();
    const { recordUsage } = build(store, tx);

    await recordUsage.execute(input);

    expect(store.txs).toHaveLength(2);
    for (const seen of store.txs) expect(seen).toBe(tx);
  });

  it("counts a redelivered record once and reports the second as a duplicate", async () => {
    const { recordUsage, usageCounters } = build(new TxRecordingStore(), undefined);

    const first = await recordUsage.execute(input);
    const second = await recordUsage.execute(input);

    expect(first.ok && first.value.duplicate).toBe(false);
    expect(second.ok && second.value.duplicate).toBe(true);
    const counter = await usageCounters.findByTenantRefAndResource("t-1", "PRODUCT", "t-1");
    expect(counter?.amount).toBe(1);
  });

  it("counts two different records twice", async () => {
    const { recordUsage, usageCounters } = build(new TxRecordingStore(), undefined);

    await recordUsage.execute(input);
    await recordUsage.execute({ ...input, recordId: "record-2" });

    const counter = await usageCounters.findByTenantRefAndResource("t-1", "PRODUCT", "t-1");
    expect(counter?.amount).toBe(2);
  });

  it("leaves NO marker behind when the counter refuses the record, so its retry is not swallowed as a duplicate", async () => {
    // A record in a different unit is refused by the counter. If the marker were written first, that
    // refusal would commit a marker with nothing behind it and the retry would be acked as "duplicate"
    // instead of reaching the DLQ.
    const store = new TxRecordingStore();
    const { recordUsage, usageCounters } = build(store, undefined);
    await recordUsage.execute(input);
    const refused = { ...input, recordId: "record-2", unit: "gb" };

    const first = await recordUsage.execute(refused);
    const retry = await recordUsage.execute(refused);

    expect(!first.ok && first.error).toBeInstanceOf(BusinessRuleError);
    expect(!retry.ok && retry.error).toBeInstanceOf(BusinessRuleError);
    expect(store.seen.has("record-2")).toBe(false);
    const counter = await usageCounters.findByTenantRefAndResource("t-1", "PRODUCT", "t-1");
    expect(counter?.amount).toBe(1);
    expect(counter?.unit).toBe("count");
  });
});

describe("InMemoryProcessedUsageRecordStore", () => {
  it("refuses a second mark of the same record, so of two interleaved deliveries only one commits", async () => {
    const store = new InMemoryProcessedUsageRecordStore();

    await store.markProcessed("record-1");

    await expect(store.markProcessed("record-1")).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(store.markProcessed("record-2")).resolves.toBeUndefined();
  });
});
