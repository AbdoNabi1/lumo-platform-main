import { describe, expect, it } from "vitest";
import type { Database } from "@platform/db";
import { createFakePrisma } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { wireOnlineStore, type OnlineStoreWiringDeps } from "./composition";
import { ThemePublished } from "./domain/events";
import { OnlineStoreEventTranslator } from "./infrastructure/event-translator";
import { fakeHasher, fakeImageRefs } from "./testing/fakes";

const T = "t-1";
const now = new Date("2026-10-27T10:00:00.000Z");

function wiringDeps(): OnlineStoreWiringDeps {
  let id = 0;
  return {
    serializer: new InMemoryEventSerializer(),
    idGenerator: {
      generate: () => `00000000-0000-7000-8000-${String((id += 1)).padStart(12, "0")}`,
    },
    clock: { now: () => now },
    imageRefs: fakeImageRefs({}),
    passwordHasher: fakeHasher(() => 0),
    shopHost: { primaryHostname: async () => null },
    storeIdentity: { storeName: async () => "Nour" },
    linkTargets: {
      resolve: async (ids) => ({
        collection: Object.fromEntries(
          ids.collection.map((id) => [
            id,
            { href: "/collections/sale", title: "Sale", published: true },
          ]),
        ),
        product: {},
        page: {},
      }),
      search: async () => [],
    },
  };
}

/** The same walk as apps/admin's tenant-mode guard: own keys, Map and Set contents skipped. */
function pathsToTenantFields(root: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<object>();
  const walk = (value: unknown, path: string): void => {
    if (typeof value !== "object" || value === null || seen.has(value)) return;
    if (value instanceof Map || value instanceof Set || value instanceof Promise) return;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") continue;
      if (/tenantId$/i.test(key)) found.push(`${path}.${key}`);
      walk((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  };
  walk(root, "wired");
  return found;
}

describe("wireOnlineStore", () => {
  it("in memory: an edit reaches the bus as a versioned event", async () => {
    const wired = wireOnlineStore(wiringDeps());
    const draft = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
    draft.header.sticky = true;
    await wired.controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: draft });
    await wired.controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "a" });
    await wired.controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    await wired.controller.updatePreferences({
      tenantId: T,
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    expect(await wired.drainOutbox()).toBe(3);
    expect(wired.deliveredEventTypes).toEqual([
      "online_store.theme.published",
      "online_store.access.changed",
      "online_store.preferences.updated",
    ]);
  });

  it("publicReads take the tenant per call", async () => {
    const { publicReads, controller } = wireOnlineStore(wiringDeps());
    await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    expect((await publicReads.access(T)).body).toMatchObject({ locked: true });
    expect((await publicReads.access("t-2")).body).toMatchObject({ locked: false });
    expect((await publicReads.shell(T)).body).toMatchObject({ locked: true, storeName: "Nour" });
    expect((await publicReads.shell(T, "bad")).status).toBe(401);
    expect((await publicReads.unlock(T, "1234")).status).toBe(200);
    expect((await publicReads.unlock("t-2", "1234")).status).toBe(401);
  });

  it("Prisma: every event is written with the tenant of the call", async () => {
    const fake = createFakePrisma();
    const wired = wireOnlineStore({ ...wiringDeps(), prisma: fake.database as Database });
    const res = await wired.controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    expect(res.status).toBe(200);
    expect(fake.rowsOf("outboxEntry")).toMatchObject([
      { tenantId: T, topic: "online_store.access.changed.v1", producer: "online-store" },
    ]);
    expect(await wired.drainOutbox()).toBe(0);
    expect(wired.deliveredEventTypes).toEqual([]);
  });

  it.each([
    ["in memory", () => undefined],
    ["Prisma", () => createFakePrisma().database as Database],
  ])("%s: menus are wired, and their links resolve through the given port", async (_, prisma) => {
    const database = prisma();
    const { controller, publicReads } = wireOnlineStore({
      ...wiringDeps(),
      ...(database === undefined ? {} : { prisma: database }),
    });
    const created = await controller.createMenu({
      tenantId: T,
      handle: "sale",
      title: "Sale",
      items: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          label: { en: "Sale" },
          link: { type: "collection", id: "c-1" },
          children: [],
        },
      ],
    });
    expect(created).toMatchObject({ status: 201, body: { handle: "sale", version: 1 } });
    const listed = (await controller.listMenus({ tenantId: T })).body as {
      menus: { handle: string }[];
    };
    expect(listed.menus.map((m) => m.handle)).toEqual(["main-menu", "footer", "sale"]);
    expect((await publicReads.shell(T)).body).toMatchObject({
      header: { menu: [{ href: "/" }, { href: "/search" }] },
    });
  });

  it.each([
    ["in memory", () => undefined],
    ["Prisma", () => createFakePrisma().database as Database],
  ])("%s: a tenant on the wiring deps never enters the graph (ADR-0014)", (_, prisma) => {
    const database = prisma();
    const wired = wireOnlineStore({
      ...wiringDeps(),
      ...(database === undefined ? {} : { prisma: database }),
      // apps/admin's AdminWiringDeps carries one; nothing here may keep it.
      ...{ tenantId: "pinned", defaultTenantId: "pinned" },
    });
    expect(pathsToTenantFields(wired)).toEqual([]);
  });
});

describe("OnlineStoreEventTranslator", () => {
  it("translates its own events and ignores the rest", () => {
    const translator = new OnlineStoreEventTranslator();
    const event = new ThemePublished(
      { eventId: "e-1", aggregateId: UniqueEntityId.from(T), occurredAt: now },
      { releaseNumber: 3 },
    );
    expect(translator.translate(event)).toEqual({
      type: "online_store.theme.published",
      eventVersion: 1,
      aggregateType: "online_store",
      payload: { releaseNumber: 3 },
    });
    expect(translator.translate({ eventName: "x" } as never)).toBeUndefined();
  });
});
