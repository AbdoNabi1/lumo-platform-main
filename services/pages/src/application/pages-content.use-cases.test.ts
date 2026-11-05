import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePages } from "../composition";
import { UniqueEntityId } from "@platform/domain";
import { ConcurrencyError } from "@platform/utils";
import { Page } from "../domain/page";
import type { PageRepository, TemplateRepository } from "../domain/repositories";
import { RoutePath } from "../domain/value-objects/route-path";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { present } from "../interfaces/presenter";
import { AdvancePage, UpdatePageContent } from "./pages.use-cases";

const T = "t-1";
function setup() {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const clock: Clock = { now: () => new Date("2026-11-04T10:00:00.000Z") };
  return wirePages({ serializer: new InMemoryEventSerializer(), idGenerator, clock }).pages;
}
const create = async (pages: ReturnType<typeof setup>, routePath: string, content = {}) =>
  (
    (await pages.createPage({ name: "About", routePath, tenantId: T, ...content })).body as {
      pageId: string;
    }
  ).pageId;

describe("page content (spec 2.4)", () => {
  it("creates with content in one call and versions like the database (Rulings 17, 18)", async () => {
    const pages = setup();
    const id = await create(pages, "/pages/about", {
      title: { ar: "من نحن" },
      body: { ar: "مرحباً" },
    });
    const page = (await pages.getPage({ pageId: id, tenantId: T })).body as Page;
    expect(page.title).toEqual({ ar: "من نحن" });
    expect(page.version).toBe(1);
  });

  it("updates a draft and a published page; a stale version is VERSION_CONFLICT", async () => {
    const pages = setup();
    const id = await create(pages, "/pages/about");
    const first = await pages.updatePageContent({
      pageId: id,
      tenantId: T,
      expectedVersion: 1,
      title: { en: "About" },
      body: {},
      metaDescription: {},
    });
    expect(first).toMatchObject({ status: 200, body: { pageId: id, version: 2 } });
    await pages.advancePage({ pageId: id, toStatus: "published", tenantId: T });
    const live = await pages.updatePageContent({
      pageId: id,
      tenantId: T,
      expectedVersion: 3,
      title: { en: "About us" },
      body: {},
      metaDescription: {},
    });
    expect(live.status).toBe(200);
    const stale = await pages.updatePageContent({
      pageId: id,
      tenantId: T,
      expectedVersion: 1,
      title: {},
      body: {},
      metaDescription: {},
    });
    expect(stale).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
  });

  it("validates before writing: 422 with the field and the code, nothing saved", async () => {
    const pages = setup();
    const id = await create(pages, "/pages/about");
    const res = await pages.updatePageContent({
      pageId: id,
      tenantId: T,
      expectedVersion: 1,
      title: {},
      body: { en: "[x](javascript:y)" },
      metaDescription: {},
    });
    expect(res.status).toBe(422);
    expect((res.body as { fields: unknown[] }).fields).toEqual([
      { field: "body.en", message: "UNSAFE_LINK" },
    ]);
    expect(((await pages.getPage({ pageId: id, tenantId: T })).body as Page).version).toBe(1);
  });

  it("an unknown page is PAGE_NOT_FOUND; another shop's page is unknown", async () => {
    const pages = setup();
    const id = await create(pages, "/pages/about");
    const res = await pages.updatePageContent({
      pageId: id,
      tenantId: "t-2",
      expectedVersion: 1,
      title: {},
      body: {},
      metaDescription: {},
    });
    expect(res).toMatchObject({ status: 404, body: { code: "PAGE_NOT_FOUND" } });
  });

  it("a taken route is ROUTE_PATH_TAKEN; an archived page takes no content (PAGE_ARCHIVED)", async () => {
    const pages = setup();
    const id = await create(pages, "/pages/about");
    const again = await pages.createPage({ name: "Again", routePath: "/pages/about", tenantId: T });
    expect(again).toMatchObject({ status: 409, body: { code: "ROUTE_PATH_TAKEN" } });
    await pages.advancePage({ pageId: id, toStatus: "archived", tenantId: T });
    const res = await pages.updatePageContent({
      pageId: id,
      tenantId: T,
      expectedVersion: 2,
      title: {},
      body: {},
      metaDescription: {},
    });
    expect(res).toMatchObject({ status: 409, body: { code: "PAGE_ARCHIVED" } });
  });

  it("an invalid create writes nothing (422 before the unit of work)", async () => {
    const pages = setup();
    const res = await pages.createPage({
      name: "About",
      routePath: "/pages/about",
      tenantId: T,
      body: { en: "[x](javascript:y)" },
    });
    expect(res.status).toBe(422);
    expect((await pages.listPages({ tenantId: T })).body).toMatchObject({ items: [] });
  });
});

describe("published reads (spec 2.4, Ruling 22)", () => {
  it("by path only when published; the list is /pages/* published, by handle, capped", async () => {
    const pages = setup();
    const about = await create(pages, "/pages/about");
    const faq = await create(pages, "/pages/faq");
    await create(pages, "/pages/draft-only");
    const other = await create(pages, "/landing");
    for (const id of [about, faq, other]) {
      await pages.advancePage({ pageId: id, toStatus: "published", tenantId: T });
    }
    expect(
      (await pages.publishedPageByPath({ routePath: "/pages/draft-only", tenantId: T })).status,
    ).toBe(404);
    expect(
      (await pages.publishedPageByPath({ routePath: "/pages/about", tenantId: "t-2" })).status,
    ).toBe(404);
    expect(
      (await pages.publishedPageByPath({ routePath: "/pages/about", tenantId: T })).status,
    ).toBe(200);
    const list = (await pages.listPublishedPages({ tenantId: T })).body as Page[];
    expect(list.map((p) => p.routePath.value)).toEqual(["/pages/about", "/pages/faq"]);
    const one = (await pages.listPublishedPages({ tenantId: T, first: 1 })).body as Page[];
    expect(one).toHaveLength(1);
    await pages.advancePage({ pageId: faq, toStatus: "draft", tenantId: T });
    expect(((await pages.listPublishedPages({ tenantId: T })).body as Page[]).length).toBe(1);
  });

  it("by ids is tenant-scoped and skips unknown ids", async () => {
    const pages = setup();
    const id = await create(pages, "/pages/about");
    const mine = (await pages.getByIds({ ids: [id, "nope"], tenantId: T })).body as Page[];
    expect(mine.map((p) => p.id.toString())).toEqual([id]);
    expect((await pages.getByIds({ ids: [id], tenantId: "t-2" })).body).toEqual([]);
  });
});

describe("a lost race is VERSION_CONFLICT, not a 500 (preflight 14)", () => {
  it("advancePage answers 409 when the save loses the version guard", async () => {
    const page = Page.create(
      UniqueEntityId.from("p-1"),
      "About",
      (RoutePath.create("/pages/about") as { value: RoutePath }).value,
    );
    const pages = {
      findById: async () => page,
      save: async () => {
        throw new ConcurrencyError("stale");
      },
    } as unknown as PageRepository;
    const advance = new AdvancePage({
      pages,
      templates: {} as TemplateRepository,
      unitOfWork: new InMemoryUnitOfWork(),
      idGenerator: { generate: () => "e1" },
      clock: { now: () => new Date("2026-11-04T10:00:00.000Z") },
    });
    const res = present(
      await advance.execute({ pageId: "p-1", toStatus: "published", tenantId: T }),
      200,
    );
    expect(res).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
  });
});

describe("UpdatePageContent race (preflight 14)", () => {
  it("a ConcurrencyError from save is 409 VERSION_CONFLICT with the code", async () => {
    const route = RoutePath.create("/pages/about");
    if (!route.ok) throw new Error("test setup");
    const page = Page.reconstitute(UniqueEntityId.from("p-1"), "About", route.value, "draft", 1);
    const pages = {
      findById: async () => page,
      save: async () => {
        throw new ConcurrencyError("stale");
      },
    } as unknown as PageRepository;
    const update = new UpdatePageContent({
      pages,
      templates: {} as TemplateRepository,
      unitOfWork: new InMemoryUnitOfWork(),
      idGenerator: { generate: () => "e1" },
      clock: { now: () => new Date("2026-11-04T10:00:00.000Z") },
    });
    const res = present(
      await update.execute({
        pageId: "p-1",
        tenantId: T,
        expectedVersion: 1,
        title: {},
        body: {},
        metaDescription: {},
      }),
      200,
    );
    expect(res).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
  });
});
