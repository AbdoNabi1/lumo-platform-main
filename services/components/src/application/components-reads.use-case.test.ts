import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CreateComponentDefinition } from "./components.use-cases";
import { GetComponentDefinition } from "./get-component-definition.use-case";
import { ListComponentDefinitions } from "./list-component-definitions.use-case";
import { ComponentsEventTranslator } from "../infrastructure/components-event-translator";
import { InMemoryComponentDefinitionRepository } from "../infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new ComponentsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "components",
  });
  const context = rootEventContext(sequentialIds());
  const definitions = new InMemoryComponentDefinitionRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { definitions, unitOfWork, idGenerator, clock };
}

function createInput(key: string) {
  return {
    key,
    name: "Hero",
    properties: [{ name: "title", type: "string" as const, required: true }],
    slots: ["content"],
    events: ["onClick"],
    responsive: true,
    tenantId: "tenant-1",
  };
}

describe("Components read use-cases (Phase 4 T4.9)", () => {
  it("ListComponentDefinitions paginates", async () => {
    const h = harness();
    const create = new CreateComponentDefinition(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute(createInput(`component-${i}`));
    }

    const page = await new ListComponentDefinitions(h).execute({ first: 2, tenantId: "tenant-1" });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListComponentDefinitions(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
      tenantId: "tenant-1",
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetComponentDefinition returns the definition, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreateComponentDefinition(h).execute(createInput("hero"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetComponentDefinition(h).execute({
      componentDefinitionId: created.value.componentDefinitionId,
      tenantId: "tenant-1",
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.key).toBe("hero");

    const missing = await new GetComponentDefinition(h).execute({
      componentDefinitionId: "nope",
      tenantId: "tenant-1",
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
