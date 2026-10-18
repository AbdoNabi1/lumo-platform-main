import { describe, expect, it } from "vitest";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createFakePrisma } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { RecommendationModel } from "../domain/recommendation-model";
import { RecommendationStrategy } from "../domain/value-objects/recommendation-strategy";
import { PrismaRecommendationModelRepository } from "./prisma-recommendation-model-repository";
import { RecommendationModelMapper } from "./recommendation-model.mapper";
import { RecommendationsEventTranslator } from "./recommendations-event-translator";

/**
 * `PrismaRecommendationModelRepository` over `@platform/db/testing`'s fake client: row mapping,
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
    translator: new RecommendationsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => T0 },
    producer: "recommendations",
  });
  const repository = new PrismaRecommendationModelRepository({
    prisma,
    outbox,
    context: rootEventContext({ generate: nextId }),
  });
  const unitOfWork = new PrismaUnitOfWork(prisma);
  const save = (model: RecommendationModel, tenantId: string) =>
    unitOfWork.run((tx) => repository.save(model, tenantId, tx));
  return { fake, repository, save, nextId };
}

function activeModel(id: string, name = "related-products"): RecommendationModel {
  const strategy = RecommendationStrategy.create("related");
  if (!strategy.ok) throw new Error("test setup: invalid strategy");
  const model = RecommendationModel.create(UniqueEntityId.from(id), name, strategy.value);
  model.startTraining(`${id}-e1`, T0);
  model.activate(`${id}-e2`, T0);
  return model;
}

describe("PrismaRecommendationModelRepository over a fake client", () => {
  it("creates a new model and reads it back by id and by name, sets included", async () => {
    const { fake, repository, save, nextId } = wire();
    const model = activeModel(nextId());
    model.generate("product-1", [{ productRef: "product-2", score: 0.9 }], nextId(), T0);

    await save(model, "tenant-a");

    const byId = await repository.findById(model.id.toString(), "tenant-a");
    expect(byId?.name).toBe("related-products");
    expect(byId?.status.value).toBe("active");
    expect(byId?.version).toBe(1);
    expect(byId?.sets[0]?.anchorRef).toBe("product-1");
    expect(byId?.sets[0]?.scoredRefs).toEqual([{ productRef: "product-2", score: 0.9 }]);
    expect(byId?.sets[0]?.generatedAt).toEqual(T0);
    expect((await repository.findByName("related-products", "tenant-a"))?.id.toString()).toBe(
      model.id.toString(),
    );
    expect(fake.rowsOf("recommendationModel")[0]?.["sets"]).toEqual([
      {
        anchorRef: "product-1",
        scoredRefs: [{ productRef: "product-2", score: 0.9 }],
        generatedAt: T0.toISOString(),
      },
    ]);
  });

  it("writes one outbox row per raised event through the same transaction client", async () => {
    const { fake, save, nextId } = wire();
    const model = activeModel(nextId());
    model.generate("product-1", [], nextId(), T0);

    await save(model, "tenant-a");

    // training + active + set.generated
    expect(fake.rowsOf("outboxEntry")).toHaveLength(3);
    expect(model.pullDomainEvents()).toEqual([]);
  });

  it("updates a loaded model with a version check and bumps the version", async () => {
    const { repository, save, nextId } = wire();
    const model = activeModel(nextId());
    await save(model, "tenant-a");

    const loaded = (await repository.findById(model.id.toString(), "tenant-a"))!;
    loaded.regenerate("product-1", [{ productRef: "product-3", score: 0.5 }], nextId(), T0);
    loaded.retire(nextId(), T0);
    await save(loaded, "tenant-a");

    const reloaded = await repository.findById(model.id.toString(), "tenant-a");
    expect(reloaded?.version).toBe(2);
    expect(reloaded?.status.value).toBe("retired");
    expect(reloaded?.sets.map((set) => set.anchorRef)).toEqual(["product-1"]);
  });

  it("rejects a save from a stale copy with ConcurrencyError and leaves the row as it was", async () => {
    const { repository, save, nextId } = wire();
    const model = activeModel(nextId());
    await save(model, "tenant-a");
    const first = (await repository.findById(model.id.toString(), "tenant-a"))!;
    const second = (await repository.findById(model.id.toString(), "tenant-a"))!;

    first.retire(nextId(), T0);
    await save(first, "tenant-a");
    second.regenerate("product-9", [], nextId(), T0);

    await expect(save(second, "tenant-a")).rejects.toBeInstanceOf(ConcurrencyError);
    const current = await repository.findById(model.id.toString(), "tenant-a");
    expect(current?.status.value).toBe("retired");
    expect(current?.sets).toEqual([]);
  });

  it("refuses to save outside a unit of work (ADR-0003)", async () => {
    const { repository, nextId } = wire();

    await expect(repository.save(activeModel(nextId()), "tenant-a")).rejects.toThrow(
      /transaction client/,
    );
  });

  it("never reads or updates another tenant's model (ADR-0014)", async () => {
    const { repository, save, nextId } = wire();
    const model = activeModel(nextId());
    await save(model, "tenant-a");

    expect(await repository.findById(model.id.toString(), "tenant-b")).toBeNull();
    expect(await repository.findByName("related-products", "tenant-b")).toBeNull();
    expect((await repository.list({}, "tenant-b")).items).toEqual([]);

    const loaded = (await repository.findById(model.id.toString(), "tenant-a"))!;
    loaded.retire(nextId(), T0);
    await expect(save(loaded, "tenant-b")).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("lists a tenant's models a page at a time, resuming from the cursor", async () => {
    const { repository, save, nextId } = wire();
    for (const name of ["a", "b", "c"]) await save(activeModel(nextId(), name), "tenant-a");

    const first = await repository.list({ first: 2 }, "tenant-a");
    expect(first.items.map((m) => m.name)).toEqual(["a", "b"]);
    expect(first.pageInfo.hasNextPage).toBe(true);

    const rest = await repository.list({ first: 2, after: first.pageInfo.endCursor! }, "tenant-a");
    expect(rest.items.map((m) => m.name)).toEqual(["c"]);
    expect(rest.pageInfo.hasNextPage).toBe(false);
  });

  it("reuses the caller's transaction client for reads when one is given", async () => {
    const { fake, repository, save, nextId } = wire();
    const model = activeModel(nextId());
    await save(model, "tenant-a");

    const tx = fake.database;
    expect(await repository.findById(model.id.toString(), "tenant-a", tx)).not.toBeNull();
    expect(await repository.findByName("related-products", "tenant-a", tx)).not.toBeNull();
    expect((await repository.list({}, "tenant-a", tx)).items).toHaveLength(1);
  });
});

describe("RecommendationModelMapper", () => {
  it("rejects a row whose strategy is not one the domain knows", () => {
    expect(() =>
      RecommendationModelMapper.toDomain({
        id: "00000000-0000-7000-8000-000000000001",
        name: "broken",
        strategy: "astrology",
        status: "draft",
        sets: [],
        version: 1,
      }),
    ).toThrow(/Corrupt recommendation-model row: invalid strategy/);
  });
});
