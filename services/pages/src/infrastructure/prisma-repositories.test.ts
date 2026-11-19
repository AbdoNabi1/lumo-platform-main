import { describe, expect, it } from "vitest";
import type { TransactionClient } from "@platform/db";
import { createFakePrisma } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { Page } from "../domain/page";
import { RoutePath } from "../domain/value-objects/route-path";
import { PagesEventTranslator } from "./pages-event-translator";
import { PrismaPageRepository } from "./prisma-repositories";

const now = new Date("2026-11-04T10:00:00.000Z");

function deps(prisma: ConstructorParameters<typeof PrismaPageRepository>[0]["prisma"]) {
  let n = 0;
  return {
    prisma,
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new PagesEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => now },
      producer: "pages",
    }),
    context: rootEventContext({
      generate: () => `00000000-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
    }),
  };
}

const draft = (n: number, path: string) => {
  const route = RoutePath.create(path);
  if (!route.ok) throw new Error("test setup: invalid route path");
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const page = Page.create(UniqueEntityId.from(id), "P", route.value, {}, undefined, now);
  page.publish("e", now);
  return page;
};

describe("PrismaPageRepository.save version guard (fake client)", () => {
  it("a save whose version guard matches no row throws ConcurrencyError", async () => {
    const calls: unknown[] = [];
    const tx = {
      page: {
        updateMany: async (args: unknown) => {
          calls.push(args);
          return { count: 0 };
        },
      },
    } as unknown as TransactionClient;
    const repo = new PrismaPageRepository(deps(createFakePrisma().database));
    const route = RoutePath.create("/pages/about");
    if (!route.ok) throw new Error("test setup");
    const stale = Page.reconstitute(UniqueEntityId.from("p-1"), "P", route.value, "draft", 3);
    await expect(repo.save(stale, "t-1", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ where: { id: "p-1", tenantId: "t-1", version: 3 } });
  });
});

describe("PrismaPageRepository.listPublished (fake client)", () => {
  it("nested and dynamic paths do not crowd valid pages out of the limit", async () => {
    const fake = createFakePrisma();
    const repo = new PrismaPageRepository(deps(fake.database));
    const tx = fake.database as unknown as TransactionClient;
    const nested = ["/pages/a/b", "/pages/a/c", "/pages/a/d", "/pages/:slug", "/pages/a/e"];
    let n = 0;
    for (const path of nested) await repo.save(draft((n += 1), path), "t-1", tx);
    await repo.save(draft((n += 1), "/pages/zeta"), "t-1", tx);
    await repo.save(draft((n += 1), "/pages/alpha"), "t-1", tx);
    const found = await repo.listPublished("t-1", 2, tx);
    expect(found.map((p) => p.routePath.value)).toEqual(["/pages/alpha", "/pages/zeta"]);
  });
});
