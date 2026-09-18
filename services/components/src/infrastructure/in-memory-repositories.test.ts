import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { ComponentDefinition } from "../domain/component-definition";
import { ComponentContract } from "../domain/value-objects/component-contract";
import { ComponentSchema } from "../domain/value-objects/component-schema";
import { ComponentsEventTranslator } from "./components-event-translator";
import { InMemoryComponentDefinitionRepository } from "./in-memory-repositories";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new ComponentsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "components",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryComponentDefinitionRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryComponentDefinitionRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's definition by id, key, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const definition = ComponentDefinition.create(
      UniqueEntityId.from(nextId()),
      "hero",
      "Hero",
      ComponentSchema.create([]),
      ComponentContract.create({ slots: [], events: [], responsive: true }),
    );
    await repository.save(definition, "tenant-a");

    expect(await repository.findById(definition.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(definition.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findByKey("hero", "tenant-a")).not.toBeNull();
    expect(await repository.findByKey("hero", "tenant-b")).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((d) => d.id.toString())).toContain(definition.id.toString());
    expect(pageB.items.map((d) => d.id.toString())).not.toContain(definition.id.toString());
  });
});

describe("InMemoryComponentDefinitionRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("components", async (outbox, tenantId) => {
      const nextId = monotonicIds();
      const repository = new InMemoryComponentDefinitionRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const agg = ComponentDefinition.create(
        UniqueEntityId.from(nextId()),
        "hero",
        "Hero",
        ComponentSchema.create([]),
        ComponentContract.create({ slots: [], events: [], responsive: true }),
      );
      agg.publish(nextId(), new Date(0));
      await repository.save(agg, tenantId);
    });
  });
});
