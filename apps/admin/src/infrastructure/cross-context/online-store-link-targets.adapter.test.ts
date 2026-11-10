import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@platform/utils";
import { wireCatalog } from "@platform/catalog";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePages } from "@platform/pages";
import {
  LINK_TARGET_BATCH,
  onlineStoreLinkTargets,
  type LinkTargetReads,
} from "./online-store-link-targets.adapter";

type Response = { readonly status: number; readonly body: unknown };

/** Fake aggregates carrying only the getters the adapter reads. */
const id = (value: string) => ({ value, toString: () => value });
const product = (key: string, name: string, slug: string, status: string) => ({
  id: id(key),
  name,
  slug: { value: slug },
  status: { value: status },
});
const collection = (key: string, name: string, slug: string, status: string) => ({
  id: id(key),
  name,
  slug: { value: slug },
  status,
});
const page = (
  key: string,
  name: string,
  routePath: string,
  status: string,
  title: { ar?: string; en?: string },
) => ({ id: id(key), name, routePath: { value: routePath }, status, title });

interface Fixtures {
  readonly products: readonly ReturnType<typeof product>[];
  readonly collections: readonly ReturnType<typeof collection>[];
  readonly pages: readonly ReturnType<typeof page>[];
}

const ok = (body: unknown): Promise<Response> => Promise.resolve({ status: 200, body });

function readsOver(fixtures: Fixtures): LinkTargetReads & {
  readonly calls: { kind: string; ids?: readonly string[]; query?: string; tenantId: string }[];
} {
  const calls: { kind: string; ids?: readonly string[]; query?: string; tenantId: string }[] = [];
  const byIds =
    <T extends { id: { value: string } }>(kind: string, list: readonly T[]) =>
    (ids: readonly string[], tenantId: string) => {
      calls.push({ kind, ids, tenantId });
      return ok(list.filter((item) => ids.includes(item.id.value)));
    };
  return {
    calls,
    products: byIds("products", fixtures.products),
    collections: byIds("collections", fixtures.collections),
    pages: byIds("pages", fixtures.pages),
    searchProducts: (query, tenantId) => {
      calls.push({ kind: "searchProducts", query, tenantId });
      return ok({ items: fixtures.products, pageInfo: { hasNextPage: false, endCursor: null } });
    },
    searchCollections: (query, tenantId) => {
      calls.push({ kind: "searchCollections", query, tenantId });
      return ok({ items: fixtures.collections, pageInfo: { hasNextPage: false, endCursor: null } });
    },
    listPages: (tenantId) => {
      calls.push({ kind: "listPages", tenantId });
      return ok({ items: fixtures.pages, pageInfo: { hasNextPage: false, endCursor: null } });
    },
  };
}

const EMPTY: Fixtures = { products: [], collections: [], pages: [] };

describe("onlineStoreLinkTargets (menu links by id, Ruling 11)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps catalogue and pages by id, with Ruling 11's published rules", async () => {
    const port = onlineStoreLinkTargets(
      readsOver({
        products: [
          product("p-1", "Lamp", "lamp", "published"),
          product("p-2", "Hidden", "hidden", "unlisted"),
          product("p-3", "Soon", "soon", "draft"),
        ],
        collections: [
          collection("c-1", "Sale", "sale", "published"),
          collection("c-2", "New", "new", "draft"),
        ],
        pages: [
          page("g-1", "About", "/pages/about", "published", { ar: "من نحن" }),
          page("g-2", "Landing", "/landing", "published", {}),
        ],
      }),
    );
    const map = await port.resolve(
      { product: ["p-1", "p-2", "p-3"], collection: ["c-1", "c-2"], page: ["g-1", "g-2"] },
      "t-1",
    );
    expect(map.product).toEqual({
      "p-1": { href: "/products/lamp", title: "Lamp", published: true },
      "p-2": { href: "/products/hidden", title: "Hidden", published: true },
      "p-3": { href: "/products/soon", title: "Soon", published: false },
    });
    expect(map.collection["c-1"]).toEqual({
      href: "/collections/sale",
      title: "Sale",
      published: true,
    });
    expect(map.collection["c-2"]).toEqual({
      href: "/collections/new",
      title: "New",
      published: false,
    });
    expect(map.page["g-1"]).toEqual({ href: "/pages/about", title: "من نحن", published: true });
    expect(map.page["g-2"]).toMatchObject({ published: false });
  });

  it("a page title is English, else Arabic, else the page name; a draft /pages/ page is not published", async () => {
    const port = onlineStoreLinkTargets(
      readsOver({
        ...EMPTY,
        pages: [
          page("g-1", "About", "/pages/about", "published", { ar: "من نحن", en: "About us" }),
          page("g-2", "Faq", "/pages/faq", "draft", {}),
          page("g-3", "Old", "/pages/old", "archived", { en: "Old" }),
        ],
      }),
    );
    const map = await port.resolve(
      { product: [], collection: [], page: ["g-1", "g-2", "g-3"] },
      "t",
    );
    expect(map.page).toEqual({
      "g-1": { href: "/pages/about", title: "About us", published: true },
      "g-2": { href: "/pages/faq", title: "Faq", published: false },
      "g-3": { href: "/pages/old", title: "Old", published: false },
    });
  });

  it("encodes each href segment", async () => {
    const port = onlineStoreLinkTargets(
      readsOver({ ...EMPTY, products: [product("p-1", "Odd", "a b?c", "published")] }),
    );
    const map = await port.resolve({ product: ["p-1"], collection: [], page: [] }, "t");
    expect(map.product["p-1"]?.href).toBe("/products/a%20b%3Fc");
  });

  it("reads only the kinds that have ids, in parallel, with the tenant of the call", async () => {
    const reads = readsOver(EMPTY);
    const port = onlineStoreLinkTargets(reads);
    expect(await port.resolve({ product: [], collection: ["c-1"], page: [] }, "t-9")).toEqual({
      product: {},
      collection: {},
      page: {},
    });
    expect(reads.calls).toEqual([{ kind: "collections", ids: ["c-1"], tenantId: "t-9" }]);
  });

  it("splits a large kind into this adapter's bounded batches, never one unbounded read", async () => {
    const reads = readsOver(EMPTY);
    const port = onlineStoreLinkTargets(reads);
    const ids = Array.from({ length: 2 * LINK_TARGET_BATCH + 5 }, (_, n) => `p-${n}`);
    await port.resolve({ product: ids, collection: [], page: [] }, "t");
    expect(LINK_TARGET_BATCH).toBe(100);
    expect(reads.calls.map((c) => c.ids?.length)).toEqual([100, 100, 5]);
  });

  it("maps are null-prototype: prototype member ids are never targets (preflight 12)", async () => {
    const port = onlineStoreLinkTargets(readsOver(EMPTY));
    const map = await port.resolve(
      { product: ["constructor"], collection: ["__proto__"], page: ["toString"] },
      "t",
    );
    expect(Object.hasOwn(map.product, "constructor")).toBe(false);
    expect(map.product["constructor"]).toBeUndefined();
    expect(map.collection["__proto__"]).toBeUndefined();
    expect(map.page["toString"]).toBeUndefined();
  });

  it("a failed read throws (the shell degrades, admin reads surface it)", async () => {
    const reads: LinkTargetReads = {
      ...readsOver(EMPTY),
      collections: () => Promise.resolve({ status: 500, body: { code: "INTERNAL" } }),
      searchCollections: () => Promise.resolve({ status: 503, body: null }),
    };
    const port = onlineStoreLinkTargets(reads);
    await expect(
      port.resolve({ product: [], collection: ["c-1"], page: [] }, "t-1"),
    ).rejects.toThrow(/collections/);
    await expect(port.search("collection", "x", "t-1")).rejects.toThrow();
  });

  it("is closures only: no controller hangs off the port (Ruling 13 of Part 1)", () => {
    const port = onlineStoreLinkTargets(readsOver(EMPTY));
    for (const value of Object.values(port)) expect(typeof value).toBe("function");
  });

  it("search maps each kind to { id, title, subtitle } and asks for at most 20", async () => {
    const products = Array.from({ length: 25 }, (_, n) =>
      product(`p-${n}`, `Lamp ${n}`, `lamp-${n}`, "published"),
    );
    const reads = readsOver({
      products,
      collections: [collection("c-1", "Sale", "sale", "draft")],
      pages: [
        page("g-1", "About", "/pages/about", "published", { ar: "من نحن" }),
        page("g-2", "Contact", "/pages/contact", "draft", { en: "Reach us" }),
        page("g-3", "Landing", "/landing", "published", { en: "About landing" }),
      ],
    });
    const port = onlineStoreLinkTargets(reads);

    const found = await port.search("product", "lamp", "t-1");
    expect(found).toHaveLength(20);
    expect(found[0]).toEqual({ id: "p-0", title: "Lamp 0", subtitle: "/products/lamp-0" });
    expect(await port.search("collection", "", "t-1")).toEqual([
      { id: "c-1", title: "Sale", subtitle: "/collections/sale" },
    ]);
    expect(await port.search("page", "من", "t-1")).toEqual([
      { id: "g-1", title: "من نحن", subtitle: "/pages/about" },
    ]);
    expect(await port.search("page", "REACH", "t-1")).toEqual([
      { id: "g-2", title: "Reach us", subtitle: "/pages/contact" },
    ]);
    // Only /pages/<handle> pages can ever be linked on the storefront.
    expect((await port.search("page", "", "t-1")).map((c) => c.id)).toEqual(["g-1", "g-2"]);
    expect(reads.calls.filter((c) => c.kind !== "listPages")).toEqual([
      { kind: "searchProducts", query: "lamp", tenantId: "t-1" },
      { kind: "searchCollections", query: "", tenantId: "t-1" },
    ]);
  });

  it("search skips a malformed row instead of failing the picker, and says so", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const reads: LinkTargetReads = {
      ...readsOver(EMPTY),
      searchProducts: () =>
        ok({ items: [{ nope: true }, product("p-1", "Lamp", "lamp", "published")] }),
    };
    expect(await onlineStoreLinkTargets(reads).search("product", "", "t")).toEqual([
      { id: "p-1", title: "Lamp", subtitle: "/products/lamp" },
    ]);
    expect(warn).toHaveBeenCalledWith("online-store link targets: malformed rows skipped", {
      kind: "product",
      skipped: 1,
      reasons: ["missing id"],
    });
  });

  it("resolve logs skipped malformed rows once per kind, with reasons and no content (review M3)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    // A getter renamed upstream: the row still arrives, without a slug.
    const renamed = {
      id: { value: "c-2" },
      name: "Secret name",
      status: "published",
      handle: { value: "secret" },
    };
    const reads: LinkTargetReads = {
      ...readsOver(EMPTY),
      collections: () =>
        ok([
          collection("c-1", "Sale", "sale", "published"),
          { ...collection("c-3", "Hidden", "hidden", "draft"), slug: undefined },
          renamed,
          null,
        ]),
      pages: () => ok([{ id: { value: "g-1" }, name: "About", status: "published" }]),
    };
    const map = await onlineStoreLinkTargets(reads).resolve(
      { product: [], collection: ["c-1", "c-2", "c-3"], page: ["g-1"] },
      "t-1",
    );
    expect(Object.keys(map.collection)).toEqual(["c-1"]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("online-store link targets: malformed rows skipped", {
      kind: "collection",
      skipped: 3,
      reasons: ["missing slug", "not an object"],
    });
    expect(warn).toHaveBeenCalledWith("online-store link targets: malformed rows skipped", {
      kind: "page",
      skipped: 1,
      reasons: ["missing route path"],
    });
    const logged = JSON.stringify(warn.mock.calls);
    for (const content of ["Secret", "secret", "Hidden", "c-2", "c-3", "About", "g-1", "t-1"]) {
      expect(logged).not.toContain(content);
    }
  });

  it("a healthy resolve logs nothing", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const reads = readsOver({ ...EMPTY, products: [product("p-1", "Lamp", "lamp", "draft")] });
    await onlineStoreLinkTargets(reads).resolve(
      { product: ["p-1"], collection: [], page: [] },
      "t",
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("onlineStoreLinkTargets over the real Catalog and Pages controllers", () => {
  it("reads real aggregates: ids, slugs, route paths and statuses resolve as Ruling 11 says", async () => {
    let n = 0;
    const deps = {
      serializer: new InMemoryEventSerializer(),
      idGenerator: {
        generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
      },
      clock: { now: () => new Date("2026-11-05T10:00:00.000Z") },
    };
    const catalog = wireCatalog(deps);
    const pages = wirePages(deps).pages;
    const T = "t-1";
    const bodyOf = <B>(res: { status: number; body: unknown }): B => {
      expect(res.status).toBeLessThan(300);
      return res.body as B;
    };
    const sale = bodyOf<{ id: string }>(
      await catalog.collections.create({ name: "Sale", slug: "sale", tenantId: T }),
    ).id;
    await catalog.collections.publish({ collectionId: sale, tenantId: T });
    const draft = bodyOf<{ id: string }>(
      await catalog.collections.create({ name: "Soon", slug: "soon", tenantId: T }),
    ).id;
    const lamp = bodyOf<{ id: string }>(
      await catalog.products.create({
        sku: "LAMP",
        name: "Lamp",
        slug: "lamp",
        variants: [{ sku: "LAMP-1", priceAmountMinor: 1000, currency: "EGP" }],
        tenantId: T,
      }),
    ).id;
    await catalog.products.unlist({ productId: lamp, tenantId: T });
    const about = bodyOf<{ pageId: string }>(
      await pages.createPage({
        name: "About",
        routePath: "/pages/about",
        title: { ar: "من نحن" },
        tenantId: T,
      }),
    ).pageId;
    await pages.advancePage({ pageId: about, toStatus: "published", tenantId: T });

    const port = onlineStoreLinkTargets({
      products: (ids, tenantId) => catalog.products.getByIds({ ids, tenantId }),
      collections: (ids, tenantId) => catalog.collections.getByIds({ ids, tenantId }),
      pages: (ids, tenantId) => pages.getByIds({ ids, tenantId }),
      searchProducts: (query, tenantId) =>
        catalog.products.list({ ...(query === "" ? {} : { query }), first: 20, tenantId }),
      searchCollections: (query, tenantId) =>
        catalog.collections.list({ ...(query === "" ? {} : { query }), first: 20, tenantId }),
      listPages: (tenantId) => pages.listPages({ first: 100, tenantId }),
    });
    const map = await port.resolve(
      { collection: [sale, draft], product: [lamp], page: [about] },
      T,
    );
    expect(map.collection[sale]).toEqual({
      href: "/collections/sale",
      title: "Sale",
      published: true,
    });
    expect(map.collection[draft]).toMatchObject({ published: false });
    expect(map.product[lamp]).toEqual({ href: "/products/lamp", title: "Lamp", published: true });
    expect(map.page[about]).toEqual({ href: "/pages/about", title: "من نحن", published: true });
    // Another shop sees none of them.
    expect(
      await port.resolve({ collection: [sale], product: [lamp], page: [about] }, "t-2"),
    ).toEqual({ collection: {}, product: {}, page: {} });
    expect(await port.search("collection", "sa", T)).toEqual([
      { id: sale, title: "Sale", subtitle: "/collections/sale" },
    ]);
    expect(await port.search("page", "", T)).toEqual([
      { id: about, title: "من نحن", subtitle: "/pages/about" },
    ]);
  });
});
