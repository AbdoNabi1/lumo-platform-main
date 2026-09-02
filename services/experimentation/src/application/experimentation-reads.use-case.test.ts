import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CreateExperiment } from "./experiment.use-cases";
import { GetExperiment } from "./get-experiment.use-case";
import { ListExperiments } from "./list-experiments.use-case";
import { ExperimentationEventTranslator } from "../infrastructure/experimentation-event-translator";
import { InMemoryExperimentRepository } from "../infrastructure/in-memory-experiment-repository";
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
    translator: new ExperimentationEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "experiment",
  });
  const context = rootEventContext(sequentialIds());
  const experiments = new InMemoryExperimentRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { experiments, unitOfWork, idGenerator, clock };
}

function createInput(name: string) {
  return {
    name,
    variants: [
      { key: "control", allocationPercentage: 50, isControl: true },
      { key: "treatment", allocationPercentage: 50, isControl: false },
    ],
    goalMetricRef: "conversion_rate",
  };
}

describe("Experimentation read use-cases (Phase 4 T4.17)", () => {
  it("ListExperiments paginates", async () => {
    const h = harness();
    const create = new CreateExperiment(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute(createInput(`experiment-${i}`));
    }

    const page = await new ListExperiments(h).execute({ first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListExperiments(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetExperiment returns the experiment, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreateExperiment(h).execute(createInput("Checkout button color"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetExperiment(h).execute({
      experimentId: created.value.experimentId,
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.name).toBe("Checkout button color");

    const missing = await new GetExperiment(h).execute({ experimentId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
