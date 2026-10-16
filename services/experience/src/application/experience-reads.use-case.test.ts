import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CreateExperience } from "./experience.use-cases";
import { GetExperience } from "./get-experience.use-case";
import { ListExperiences } from "./list-experiences.use-case";
import { ExperienceEventTranslator } from "../infrastructure/experience-event-translator";
import { InMemoryExperienceRepository } from "../infrastructure/in-memory-repositories";
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
    translator: new ExperienceEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "experience",
  });
  const context = rootEventContext(sequentialIds());
  const experiences = new InMemoryExperienceRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { experiences, unitOfWork, idGenerator, clock };
}

describe("Experience read use-cases (Phase 4 T4.10)", () => {
  it("ListExperiences paginates", async () => {
    const h = harness();
    const create = new CreateExperience(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute({
        name: `Page ${i}`,
        experienceType: "storefront",
        tenantId: "tenant-1",
      });
    }

    const page = await new ListExperiences(h).execute({ first: 2, tenantId: "tenant-1" });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListExperiences(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
      tenantId: "tenant-1",
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetExperience returns the experience, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreateExperience(h).execute({
      name: "Homepage",
      experienceType: "storefront",
      tenantId: "tenant-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetExperience(h).execute({
      experienceId: created.value.experienceId,
      tenantId: "tenant-1",
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.name).toBe("Homepage");

    const missing = await new GetExperience(h).execute({
      experienceId: "nope",
      tenantId: "tenant-1",
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
