import { describe, expect, it } from "vitest";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createFakePrisma } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { ComponentDefinition } from "../domain/component-definition";
import { ComponentContract } from "../domain/value-objects/component-contract";
import { ComponentSchema } from "../domain/value-objects/component-schema";
import { ComponentsEventTranslator } from "./components-event-translator";
import { PrismaComponentDefinitionRepository } from "./prisma-repositories";

/**
 * `PrismaComponentDefinitionRepository` over `@platform/db/testing`'s fake client: row mapping,
 * the create/CAS-update branches, same-transaction outbox writes and tenant scoping, on every
 * `pnpm test`. Real SQL stays with the `DATABASE_URL_TEST`-gated integration suite.
 */
const T0 = new Date("2026-07-05T00:00:00.000Z");

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const fake = createFakePrisma();
  const prisma = fake.database;
  const outbox = new OutboxWriter({
    store: new PrismaOutboxStore(prisma),
    translator: new ComponentsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => T0 },
    producer: "components",
  });
  const repository = new PrismaComponentDefinitionRepository({
    prisma,
    outbox,
    context: rootEventContext({ generate: nextId }),
  });
  const unitOfWork = new PrismaUnitOfWork(prisma);
  const save = (definition: ComponentDefinition, tenantId: string) =>
    unitOfWork.run((tx) => repository.save(definition, tenantId, tx));
  return { fake, repository, save, nextId };
}

function hero(id: string, key = "hero"): ComponentDefinition {
  return ComponentDefinition.create(
    UniqueEntityId.from(id),
    key,
    "Hero banner",
    ComponentSchema.create([{ name: "title", type: "string", required: true }], { title: "Hi" }),
    ComponentContract.create({
      slots: ["media"],
      events: ["click"],
      responsive: true,
      permission: "content.edit",
    }),
    "hero-v2",
  );
}

describe("PrismaComponentDefinitionRepository over a fake client", () => {
  it("creates a definition and reads its full schema and contract back by id and by key", async () => {
    const { repository, save, nextId } = wire();
    const definition = hero(nextId());

    await save(definition, "tenant-a");

    const loaded = await repository.findById(definition.id.toString(), "tenant-a");
    expect(loaded?.key).toBe("hero");
    expect(loaded?.name).toBe("Hero banner");
    expect(loaded?.status).toBe("draft");
    expect(loaded?.version).toBe(1);
    expect(loaded?.featureFlagKey).toBe("hero-v2");
    expect(loaded?.schema.properties).toEqual([{ name: "title", type: "string", required: true }]);
    expect(loaded?.schema.defaults).toEqual({ title: "Hi" });
    expect(loaded?.contract.slots).toEqual(["media"]);
    expect(loaded?.contract.events).toEqual(["click"]);
    expect(loaded?.contract.responsive).toBe(true);
    expect(loaded?.contract.permission).toBe("content.edit");
    expect((await repository.findByKey("hero", "tenant-a"))?.id.toString()).toBe(
      definition.id.toString(),
    );
  });

  it("stores an absent permission and feature flag as null and reads them back as undefined", async () => {
    const { fake, repository, save, nextId } = wire();
    const definition = ComponentDefinition.create(
      UniqueEntityId.from(nextId()),
      "plain",
      "Plain",
      ComponentSchema.create([]),
      ComponentContract.create({ slots: [], events: [], responsive: false }),
    );

    await save(definition, "tenant-a");

    expect(fake.rowsOf("componentDefinition")[0]).toMatchObject({
      permission: null,
      featureFlagKey: null,
    });
    const loaded = await repository.findByKey("plain", "tenant-a");
    expect(loaded?.contract.permission).toBeUndefined();
    expect(loaded?.featureFlagKey).toBeUndefined();
  });

  it("writes the transition events to the outbox through the same transaction client", async () => {
    const { fake, save, nextId } = wire();
    const definition = hero(nextId());
    definition.publish(nextId(), T0);

    await save(definition, "tenant-a");

    expect(fake.rowsOf("outboxEntry")).toHaveLength(1);
    expect(definition.pullDomainEvents()).toEqual([]);
  });

  it("updates a loaded definition's status with a version check and bumps the version", async () => {
    const { repository, save, nextId } = wire();
    const definition = hero(nextId());
    await save(definition, "tenant-a");

    const loaded = (await repository.findById(definition.id.toString(), "tenant-a"))!;
    loaded.publish(nextId(), T0);
    await save(loaded, "tenant-a");

    const reloaded = await repository.findById(definition.id.toString(), "tenant-a");
    expect(reloaded?.status).toBe("published");
    expect(reloaded?.version).toBe(2);
  });

  it("rejects a save from a stale copy with ConcurrencyError and leaves the row as it was", async () => {
    const { repository, save, nextId } = wire();
    const definition = hero(nextId());
    await save(definition, "tenant-a");
    const first = (await repository.findById(definition.id.toString(), "tenant-a"))!;
    const second = (await repository.findById(definition.id.toString(), "tenant-a"))!;

    first.publish(nextId(), T0);
    await save(first, "tenant-a");
    second.archive(nextId(), T0);

    await expect(save(second, "tenant-a")).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await repository.findById(definition.id.toString(), "tenant-a"))?.status).toBe(
      "published",
    );
  });

  it("refuses to save outside a unit of work (ADR-0003)", async () => {
    const { repository, nextId } = wire();

    await expect(repository.save(hero(nextId()), "tenant-a")).rejects.toThrow(/transaction client/);
  });

  it("never reads or updates another tenant's definition (ADR-0014)", async () => {
    const { repository, save, nextId } = wire();
    const definition = hero(nextId());
    await save(definition, "tenant-a");

    expect(await repository.findById(definition.id.toString(), "tenant-b")).toBeNull();
    expect(await repository.findByKey("hero", "tenant-b")).toBeNull();
    expect((await repository.list({}, "tenant-b")).items).toEqual([]);

    const loaded = (await repository.findById(definition.id.toString(), "tenant-a"))!;
    loaded.publish(nextId(), T0);
    await expect(save(loaded, "tenant-b")).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("lists a tenant's definitions a page at a time, resuming from the cursor", async () => {
    const { repository, save, nextId } = wire();
    for (const key of ["a", "b", "c"]) await save(hero(nextId(), key), "tenant-a");

    const first = await repository.list({ first: 2 }, "tenant-a");
    expect(first.items.map((d) => d.key)).toEqual(["a", "b"]);
    expect(first.pageInfo.hasNextPage).toBe(true);

    const rest = await repository.list({ first: 2, after: first.pageInfo.endCursor! }, "tenant-a");
    expect(rest.items.map((d) => d.key)).toEqual(["c"]);
    expect(rest.pageInfo.hasNextPage).toBe(false);
  });

  it("reuses the caller's transaction client for reads when one is given", async () => {
    const { fake, repository, save, nextId } = wire();
    const definition = hero(nextId());
    await save(definition, "tenant-a");

    const tx = fake.database;
    expect(await repository.findById(definition.id.toString(), "tenant-a", tx)).not.toBeNull();
    expect(await repository.findByKey("hero", "tenant-a", tx)).not.toBeNull();
    expect((await repository.list({}, "tenant-a", tx)).items).toHaveLength(1);
  });
});
