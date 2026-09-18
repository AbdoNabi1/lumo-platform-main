import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { isValidUsageRecord, normalizeUsageRecord, type UsageRecord } from "./usage-record";
import { UsageRecorded } from "./usage-recorded.event";
import { UsageEventTranslator } from "./usage-event-translator";
import { InMemoryUsageRecorder, OutboxUsageRecorder } from "./usage-recorder.port";
import { isRegisteredResource } from "./usage-resource";

const record: UsageRecord = {
  tenant: "t-1",
  resource: "ai_credits",
  amount: 5,
  unit: "credit",
  occurredAt: "2026-07-13T00:00:00.000Z",
  metadata: { provider: "claude" },
};

describe("UsageRecord", () => {
  it("validates and normalizes", () => {
    expect(isValidUsageRecord(record)).toBe(true);
    expect(isValidUsageRecord({ ...record, amount: -1 })).toBe(false);
    expect(isValidUsageRecord({ ...record, tenant: " " })).toBe(false);
    expect(normalizeUsageRecord({ ...record, resource: " products " }).resource).toBe("products");
  });
});

describe("UsageEventTranslator", () => {
  it("maps UsageRecorded to the canonical platform.usage.recorded integration event", () => {
    const event = new UsageRecorded(
      {
        eventId: "e1",
        aggregateId: UniqueEntityId.from("t-1"),
        occurredAt: new Date(record.occurredAt),
      },
      record,
    );
    const descriptor = new UsageEventTranslator().translate(event);
    expect(descriptor?.type).toBe("platform.usage.recorded");
    expect(descriptor?.aggregateType).toBe("usage");
    expect((descriptor?.payload as UsageRecord).resource).toBe("ai_credits");
  });
});

describe("UsageResource registry", () => {
  it("recognises registered resources and flags free text", () => {
    expect(isRegisteredResource("AI_TOKEN")).toBe(true);
    expect(isRegisteredResource("MARKETPLACE_INSTALL")).toBe(true);
    expect(isRegisteredResource("made_up")).toBe(false);
  });
});

describe("InMemoryUsageRecorder", () => {
  it("captures records (producer knows no consumer)", async () => {
    const recorder = new InMemoryUsageRecorder();
    await recorder.record(record);
    expect(recorder.records).toHaveLength(1);
    expect(recorder.records[0]?.resource).toBe("ai_credits");
  });
});

describe("OutboxUsageRecorder write-time tenant (ADR-0014 Amendment 7)", () => {
  it("carries each record's tenant into the outbox envelope, not the singleton context's", async () => {
    let n = 0;
    const idGenerator = {
      generate: () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`,
    };
    await assertWriteTimeTenant("usage", async (outbox, tenantId) => {
      const recorder = new OutboxUsageRecorder({
        outbox,
        context: rootEventContext(idGenerator),
        idGenerator,
        clock: { now: () => new Date(0) },
      });
      await recorder.record({ ...record, tenant: tenantId });
    });
  });
});
