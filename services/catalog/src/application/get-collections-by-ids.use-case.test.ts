import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { TransactionClient } from "@platform/db";
import { Collection } from "../domain/collection";
import type { CollectionRepository } from "../domain/collection-repository";
import { Slug } from "../domain/value-objects/slug";
import { CatalogEventTranslator } from "../infrastructure/catalog-event-translator";
import { InMemoryCollectionRepository } from "../infrastructure/in-memory-collection-repository";
import { PrismaCollectionRepository } from "../infrastructure/prisma-catalog-repositories";
import { COLLECTIONS_BY_IDS_MAX, GetCollectionsByIds } from "./get-collections-by-ids.use-case";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function collection(id: string, slug: string): Collection {
  return Collection.create(
    UniqueEntityId.from(id),
    slug,
    must(Slug.create(slug)),
    `evt-${id}`,
    new Date(0),
  );
}

function repo(): InMemoryCollectionRepository {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new CatalogEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date(0) },
    producer: "catalog",
  });
  let n = 0;
  return new InMemoryCollectionRepository({
    outbox,
    context: rootEventContext({ generate: () => `e-${(n += 1)}` }),
  });
}

describe("GetCollectionsByIds (menu link targets, one batched read)", () => {
  it("returns the tenant's collections among the ids, skipping unknown, deleted and foreign ones", async () => {
    const collections = repo();
    const a = collection("c-a", "sale");
    const b = collection("c-b", "new");
    const foreign = collection("c-f", "theirs");
    const gone = collection("c-gone", "gone");
    gone.delete("evt-d", new Date(0));
    await collections.save(a, "t-1");
    await collections.save(b, "t-1");
    await collections.save(foreign, "t-2");
    await collections.save(gone, "t-1");

    const result = await new GetCollectionsByIds({ collections }).execute({
      ids: ["c-a", "c-f", "c-gone", "missing"],
      tenantId: "t-1",
    });

    expect(result.ok && result.value.map((c) => c.id.toString())).toEqual(["c-a"]);
  });

  it("answers an empty list for no ids without reading", async () => {
    let reads = 0;
    const collections = {
      findByIds: async () => {
        reads += 1;
        return [];
      },
    } as unknown as CollectionRepository;
    const result = await new GetCollectionsByIds({ collections }).execute({
      ids: [],
      tenantId: "t-1",
    });
    expect(result.ok && result.value).toEqual([]);
    expect(reads).toBe(0);
  });

  it("asks for at most COLLECTIONS_BY_IDS_MAX distinct ids in one read (bounded batch)", async () => {
    const asked: (readonly string[])[] = [];
    const collections = {
      findByIds: async (ids: readonly string[]) => {
        asked.push(ids);
        return [];
      },
    } as unknown as CollectionRepository;
    const ids = Array.from({ length: COLLECTIONS_BY_IDS_MAX + 20 }, (_, n) => `c-${n}`);
    await new GetCollectionsByIds({ collections }).execute({
      ids: ["c-0", ...ids],
      tenantId: "t-1",
    });
    expect(COLLECTIONS_BY_IDS_MAX).toBe(100);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(ids.slice(0, COLLECTIONS_BY_IDS_MAX));
  });
});

describe("PrismaCollectionRepository.findByIds", () => {
  const UUID_A = "11111111-1111-4111-8111-111111111111";

  it("makes ONE tenant-scoped, non-deleted read, and only asks for well-formed ids", async () => {
    const calls: unknown[] = [];
    const client = {
      collection: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [];
        },
      },
    } as unknown as TransactionClient;
    const repository = new PrismaCollectionRepository({} as never);

    await repository.findByIds([UUID_A, "not-a-uuid", UUID_A], "t1", client);

    expect(calls).toEqual([
      {
        where: { tenantId: "t1", deletedAt: null, id: { in: [UUID_A] } },
        include: { items: true },
      },
    ]);
  });

  it("makes no read at all when no id is well-formed", async () => {
    const calls: unknown[] = [];
    const client = {
      collection: { findMany: async (args: unknown) => void calls.push(args) },
    } as unknown as TransactionClient;
    const repository = new PrismaCollectionRepository({} as never);
    expect(await repository.findByIds(["__proto__"], "t1", client)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
