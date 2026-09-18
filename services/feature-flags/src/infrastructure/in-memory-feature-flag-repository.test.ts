import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { FeatureFlag } from "../domain/feature-flag";
import { FeatureFlagsEventTranslator } from "./feature-flags-event-translator";
import { InMemoryFeatureFlagRepository } from "./in-memory-feature-flag-repository";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new FeatureFlagsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "feature_flags",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryFeatureFlagRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryFeatureFlagRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's flag by id, key, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const flag = FeatureFlag.create(UniqueEntityId.from(nextId()), "checkout.new-flow", "New Flow");
    await repository.save(flag, "tenant-a");

    expect(await repository.findById(flag.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(flag.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findByKey("checkout.new-flow", "tenant-a")).not.toBeNull();
    expect(await repository.findByKey("checkout.new-flow", "tenant-b")).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((f) => f.id.toString())).toContain(flag.id.toString());
    expect(pageB.items.map((f) => f.id.toString())).not.toContain(flag.id.toString());
  });
});

describe("InMemoryFeatureFlagRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("feature-flags", async (outbox, tenantId) => {
      const nextId = monotonicIds();
      const repository = new InMemoryFeatureFlagRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const agg = FeatureFlag.create(
        UniqueEntityId.from(nextId()),
        "checkout.new-flow",
        "New Flow",
      );
      agg.kill("tester", nextId(), new Date(0));
      await repository.save(agg, tenantId);
    });
  });
});
