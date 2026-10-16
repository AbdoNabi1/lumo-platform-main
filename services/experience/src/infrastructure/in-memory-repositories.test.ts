import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { Experience } from "../domain/experience";
import { ExperienceEventTranslator } from "./experience-event-translator";
import { InMemoryExperienceRepository } from "./in-memory-repositories";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new ExperienceEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-08-30T00:00:00.000Z") },
    producer: "experience",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryExperienceRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryExperienceRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's experience by id, name, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const experience = Experience.create(UniqueEntityId.from(nextId()), "homepage", "storefront");
    await repository.save(experience, "tenant-a");

    expect(await repository.findById(experience.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(experience.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findByName("homepage", "tenant-a")).not.toBeNull();
    expect(await repository.findByName("homepage", "tenant-b")).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((e) => e.id.toString())).toContain(experience.id.toString());
    expect(pageB.items.map((e) => e.id.toString())).not.toContain(experience.id.toString());
  });
});

describe("InMemoryExperienceRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("experience", async (outbox, tenantId) => {
      const nextId = monotonicIds();
      const repository = new InMemoryExperienceRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const agg = Experience.create(UniqueEntityId.from(nextId()), "homepage", "storefront");
      agg.publish(nextId(), new Date(0));
      await repository.save(agg, tenantId);
    });
  });
});
