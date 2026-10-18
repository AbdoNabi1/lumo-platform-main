import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { rootEventContext } from "@platform/messaging";
import {
  assertWriteTimeTenant,
  CapturingOutboxWriter,
  tenantRowIsolationCases,
  type TenantRowStore,
} from "@platform/messaging/testing";
import { ConcurrencyError } from "@platform/utils";
import { Page } from "../domain/page";
import { Template } from "../domain/template";
import { RoutePath } from "../domain/value-objects/route-path";
import { PrismaPageRepository, PrismaTemplateRepository } from "./prisma-repositories";

/**
 * The Prisma repositories over `createFakePrisma`, which applies every `where` literally (no RLS):
 * what passes here passes because the repository scoped its own query. The real-Postgres suite
 * (`prisma-repositories.integration.test.ts`) only runs where `DATABASE_URL_TEST` is set.
 */
const context = rootEventContext({ generate: () => "evt-x" });
const at = new Date("2026-10-18T00:00:00.000Z");

function route(value: string): RoutePath {
  const result = RoutePath.create(value);
  if (!result.ok) throw new Error(`test setup: invalid route path ${value}`);
  return result.value;
}

function wire() {
  const fake = createFakePrisma();
  const outbox = new CapturingOutboxWriter();
  const deps = { prisma: fake.database, outbox: outbox as never, context };
  return {
    fake,
    outbox,
    tx: fake.database as unknown,
    pages: new PrismaPageRepository(deps),
    templates: new PrismaTemplateRepository(deps),
  };
}

describe("PrismaPageRepository", () => {
  it("creates a new page as version 1 with every ref, and reads it back by id and route", async () => {
    const { fake, pages, tx } = wire();
    const page = Page.create(UniqueEntityId.from("page-1"), "Product", route("/products/:slug"), {
      templateRef: "tpl-1",
      experienceRef: "exp-1",
      seoProfileRef: "seo-1",
      localeRef: "en",
    });

    await pages.save(page, "tenant-a", tx);

    expect(fake.rowsOf("page")).toEqual([
      {
        id: "page-1",
        tenantId: "tenant-a",
        name: "Product",
        routePath: "/products/:slug",
        templateRef: "tpl-1",
        experienceRef: "exp-1",
        seoProfileRef: "seo-1",
        localeRef: "en",
        status: "draft",
        version: 1,
      },
    ]);
    const byId = await pages.findById("page-1", "tenant-a");
    expect(byId?.routePath.value).toBe("/products/:slug");
    expect(byId?.routePath.isDynamic).toBe(true);
    expect(byId?.version).toBe(1);
    expect(byId?.localeRef).toBe("en");
    const byRoute = await pages.findByRoutePath("/products/:slug", "tenant-a", tx);
    expect(byRoute?.id.toString()).toBe("page-1");
  });

  it("maps absent refs to null on write and back to undefined on read", async () => {
    const { fake, pages, tx } = wire();
    await pages.save(
      Page.create(UniqueEntityId.from("page-1"), "Home", route("/")),
      "tenant-a",
      tx,
    );

    expect(fake.rowsOf("page")[0]).toMatchObject({
      templateRef: null,
      experienceRef: null,
      seoProfileRef: null,
      localeRef: null,
    });
    const read = await pages.findById("page-1", "tenant-a", tx);
    expect(read?.templateRef).toBeUndefined();
    expect(read?.seoProfileRef).toBeUndefined();
  });

  it("persists a transition by bumping the version, and writes its event under the call's tenant", async () => {
    const { fake, outbox, pages, tx } = wire();
    await pages.save(
      Page.create(UniqueEntityId.from("page-1"), "Home", route("/home")),
      "tenant-a",
      tx,
    );

    const loaded = await pages.findById("page-1", "tenant-a", tx);
    if (loaded === null) throw new Error("expected the page");
    loaded.publish("evt-1", at);
    await pages.save(loaded, "tenant-a", tx);

    expect(fake.rowsOf("page")[0]).toMatchObject({ status: "published", version: 2 });
    const published = outbox.writes.find((w) => w.events.length > 0);
    expect(published?.context.tenantId).toBe("tenant-a");
    expect(published?.events[0]).toMatchObject({
      eventName: "pages.transitioned",
      data: { ref: "/home", family: "page", action: "published" },
    });
  });

  it("rejects a stale version with a ConcurrencyError and leaves the row as it was", async () => {
    const { fake, pages, tx } = wire();
    await pages.save(
      Page.create(UniqueEntityId.from("page-1"), "Home", route("/home")),
      "tenant-a",
      tx,
    );
    const first = await pages.findById("page-1", "tenant-a", tx);
    const second = await pages.findById("page-1", "tenant-a", tx);
    if (first === null || second === null) throw new Error("expected the page");

    first.publish("evt-1", at);
    await pages.save(first, "tenant-a", tx);
    second.archive("evt-2", at);

    await expect(pages.save(second, "tenant-a", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(fake.rowsOf("page")[0]).toMatchObject({ status: "published", version: 2 });
  });

  it("refuses to save outside a unit-of-work transaction", async () => {
    const { pages } = wire();
    const page = Page.create(UniqueEntityId.from("page-1"), "Home", route("/home"));
    await expect(pages.save(page, "tenant-a")).rejects.toThrow(/transaction client/);
  });

  it("refuses to map a row whose route path is corrupt", async () => {
    const { fake, pages } = wire();
    await fake.database.page.create({
      data: {
        id: "page-1",
        tenantId: "tenant-a",
        name: "Bad",
        routePath: "Not A Path",
        status: "draft",
        version: 1,
      } as never,
    });
    await expect(pages.findById("page-1", "tenant-a")).rejects.toThrow(/Corrupt page row/);
  });

  it("lists a tenant's pages a page at a time", async () => {
    const { pages, tx } = wire();
    for (const n of [1, 2, 3]) {
      await pages.save(
        Page.create(UniqueEntityId.from(`page-${n}`), `P${n}`, route(`/p-${n}`)),
        "tenant-a",
        tx,
      );
    }
    await pages.save(
      Page.create(UniqueEntityId.from("page-9"), "Theirs", route("/p-9")),
      "tenant-b",
      tx,
    );

    const first = await pages.list({ first: 2 }, "tenant-a");
    expect(first.items.map((p) => p.id.toString())).toEqual(["page-1", "page-2"]);
    expect(first.pageInfo.hasNextPage).toBe(true);

    const rest = await pages.list(
      { first: 2, after: first.pageInfo.endCursor ?? undefined },
      "tenant-a",
      tx,
    );
    expect(rest.items.map((p) => p.id.toString())).toEqual(["page-3"]);
    expect(rest.pageInfo.hasNextPage).toBe(false);
  });

  it("merges the per-call tenantId into the outbox event context at write time", async () => {
    await assertWriteTimeTenant("pages/page (prisma)", async (outbox, tenantId) => {
      const fake = createFakePrisma();
      const repo = new PrismaPageRepository({
        prisma: fake.database,
        outbox: outbox as never,
        context,
      });
      const page = Page.create(UniqueEntityId.from("page-1"), "Home", route("/home"));
      page.publish("evt-1", at);
      await repo.save(page, tenantId, fake.database);
    });
  });
});

describe("PrismaTemplateRepository", () => {
  it("creates, finds by name, archives and lists templates", async () => {
    const { fake, templates, tx } = wire();
    await templates.save(
      Template.create(UniqueEntityId.from("tpl-1"), "landing", "exp-1"),
      "tenant-a",
      tx,
    );
    await templates.save(
      Template.create(UniqueEntityId.from("tpl-2"), "pdp", "exp-2"),
      "tenant-a",
      tx,
    );

    const landing = await templates.findByName("landing", "tenant-a");
    if (landing === null) throw new Error("expected the template");
    expect(landing.experienceRef).toBe("exp-1");
    landing.archive("evt-1", at);
    await templates.save(landing, "tenant-a", tx);

    expect(fake.rowsOf("template")[0]).toMatchObject({ status: "archived", version: 2 });
    expect((await templates.findById("tpl-1", "tenant-a", tx))?.status).toBe("archived");
    expect(await templates.findByName("landing", "tenant-b", tx)).toBeNull();

    const page = await templates.list({ first: 1 }, "tenant-a", tx);
    expect(page.items.map((t) => t.name)).toEqual(["landing"]);
    const rest = await templates.list(
      { first: 1, after: page.pageInfo.endCursor ?? undefined },
      "tenant-a",
    );
    expect(rest.items.map((t) => t.name)).toEqual(["pdp"]);
  });

  it("rejects a stale version and refuses to save outside a transaction", async () => {
    const { templates, tx } = wire();
    await templates.save(
      Template.create(UniqueEntityId.from("tpl-1"), "landing", "exp-1"),
      "tenant-a",
      tx,
    );
    const stale = Template.reconstitute(
      UniqueEntityId.from("tpl-1"),
      "landing",
      "exp-1",
      "active",
      7,
    );
    stale.archive("evt-1", at);

    await expect(templates.save(stale, "tenant-a", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(templates.save(stale, "tenant-a")).rejects.toThrow(/transaction client/);
  });
});

// ── T10.5 row isolation (shared harness) ─────────────────────────────────────────────────────────
// An update only rewrites `status`, so a forged write is made observable by archiving: `find`
// reports an archived row with an `archived:` prefix on its marker.
function pageStore(): TenantRowStore {
  const { pages, tx } = wire();
  const marker = (page: Page | null) =>
    page === null ? null : page.status === "archived" ? `archived:${page.name}` : page.name;
  return {
    insert: (tenantId, key, name) =>
      pages.save(Page.create(UniqueEntityId.from(key), name, route(`/${key}`)), tenantId, tx),
    find: async (tenantId, key) => marker(await pages.findByRoutePath(`/${key}`, tenantId)),
    list: async (tenantId) => (await pages.list({ first: 50 }, tenantId)).items.map((p) => p.name),
    update: async (tenantId, key, name) => {
      const forged = Page.reconstitute(
        UniqueEntityId.from(key),
        name,
        route(`/${key}`),
        "draft",
        1,
      );
      forged.archive("evt-forged", at);
      await pages.save(forged, tenantId, tx);
    },
  };
}

function templateStore(): TenantRowStore {
  const { templates, tx } = wire();
  const marker = (template: Template | null) =>
    template === null
      ? null
      : template.status === "archived"
        ? `archived:${template.experienceRef}`
        : template.experienceRef;
  return {
    insert: (tenantId, key, ref) =>
      templates.save(Template.create(UniqueEntityId.from(key), key, ref), tenantId, tx),
    find: async (tenantId, key) => marker(await templates.findByName(key, tenantId)),
    list: async (tenantId) =>
      (await templates.list({ first: 50 }, tenantId)).items.map((t) => t.experienceRef),
    update: async (tenantId, key, ref) => {
      const forged = Template.reconstitute(UniqueEntityId.from(key), key, ref, "active", 1);
      forged.archive("evt-forged", at);
      await templates.save(forged, tenantId, tx);
    },
  };
}

describe("pages tenant isolation over fake-prisma (T10.5)", () => {
  const layer = "prisma repository over fake-prisma (app-layer where, no RLS)";
  for (const fixture of [
    { context: "pages/page", layer, make: pageStore },
    { context: "pages/template", layer, make: templateStore },
  ])
    for (const c of tenantRowIsolationCases(fixture)) it(c.name, c.run);
});
