import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { ExampleAggregate } from "../domain/example-aggregate";
import type { ExampleRepository } from "../domain/example-repository";
import { RegisterExample } from "./register-example.use-case";

class CapturingRepository implements ExampleRepository {
  saved: ExampleAggregate | null = null;

  async save(example: ExampleAggregate): Promise<void> {
    this.saved = example;
  }

  async findById(): Promise<ExampleAggregate | null> {
    return this.saved;
  }
}

const passThroughUnitOfWork: TransactionalUnitOfWork<unknown> = {
  run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    return work(undefined);
  },
};

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };

describe("RegisterExample", () => {
  it("creates and persists an example, returning its id", async () => {
    const examples = new CapturingRepository();
    const useCase = new RegisterExample({
      examples,
      unitOfWork: passThroughUnitOfWork,
      idGenerator: sequentialIds(),
      clock,
    });

    const result = await useCase.execute({ label: "demo" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("id-1");
    }
    expect(examples.saved?.label).toBe("demo");
  });
});
