import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Experiment } from "../domain/experiment";
import { ExperimentAudience, Variant } from "../domain/value-objects/variant";
import { ExperimentationEventTranslator } from "./experimentation-event-translator";
import { InMemoryExperimentRepository } from "./in-memory-experiment-repository";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("test setup: invalid VO");
  return r.value;
}

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new ExperimentationEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "experiment",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryExperimentRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryExperimentRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's experiment by id, name, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const experiment = Experiment.create(
      UniqueEntityId.from(nextId()),
      "checkout-cta-color",
      [must(Variant.create("control", 50, true)), must(Variant.create("treatment", 50, false))],
      ExperimentAudience.everyone(),
      "conversion_rate",
    );
    await repository.save(experiment, "tenant-a");

    expect(await repository.findById(experiment.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(experiment.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findByName("checkout-cta-color", "tenant-a")).not.toBeNull();
    expect(await repository.findByName("checkout-cta-color", "tenant-b")).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((e) => e.id.toString())).toContain(experiment.id.toString());
    expect(pageB.items.map((e) => e.id.toString())).not.toContain(experiment.id.toString());
  });
});
