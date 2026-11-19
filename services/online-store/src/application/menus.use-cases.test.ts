import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { harness } from "../testing/fakes";
import type { LinkTargetMap } from "./ports";
import { itemViews, resolveItems } from "./menu-resolution";

const T = "t-1";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const link = (n: number, target: unknown, children: unknown[] = []) => ({
  id: ID(n),
  label: { en: `L${n}` },
  link: target,
  children,
});
const TARGETS = {
  [T]: {
    collection: {
      "c-live": { href: "/collections/sale", title: "Sale", published: true },
      "c-draft": { href: "/collections/soon", title: "Soon", published: false },
    },
    product: { "p-live": { href: "/products/lamp", title: "Lamp", published: true } },
  },
};

describe("menus (spec 2.2, 2.6)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists the two virtual defaults before any save", async () => {
    const { controller } = harness();
    const res = await controller.listMenus({ tenantId: T });
    expect(res.body).toEqual({
      menus: [
        {
          id: null,
          handle: "main-menu",
          title: "Main menu",
          itemCount: 2,
          isDefault: true,
          topLabels: [
            { ar: "الرئيسية", en: "Home" },
            { ar: "البحث", en: "Search" },
          ],
        },
        {
          id: null,
          handle: "footer",
          title: "Footer menu",
          itemCount: 1,
          isDefault: true,
          topLabels: [{ ar: "البحث", en: "Search" }],
        },
      ],
    });
  });

  it("the default footer gains one item per set policy", async () => {
    const { controller } = harness();
    await controller.updatePolicy({
      tenantId: T,
      type: "refund",
      by: "s",
      expectedVersion: 0,
      body: { en: "x" },
    });
    const footer = (await controller.getMenu({ tenantId: T, handle: "footer" })).body as {
      items: { link: unknown }[];
    };
    expect(footer.items.map((i) => i.link)).toEqual([
      { type: "search" },
      { type: "policy", policy: "refund" },
    ]);
  });

  it("creates, reads with broken flags and target titles, updates and deletes a menu", async () => {
    const { controller } = harness({ targets: TARGETS });
    const created = await controller.createMenu({
      tenantId: T,
      handle: "sale",
      title: "  Sale  ",
      items: [
        link(1, { type: "collection", id: "c-live" }, [link(2, { type: "product", id: "p-live" })]),
        link(3, { type: "collection", id: "c-draft" }),
        link(4, { type: "product", id: "p-gone" }),
        link(5, { type: "policy", policy: "terms" }),
      ],
    });
    expect(created.status).toBe(201);
    const menu = (await controller.getMenu({ tenantId: T, handle: "sale" })).body as {
      title: string;
      version: number;
      items: { broken: boolean; targetTitle: string | null; children: { broken: boolean }[] }[];
    };
    expect(menu.title).toBe("Sale");
    expect(menu.version).toBe(1);
    expect(menu.items.map((i) => [i.broken, i.targetTitle])).toEqual([
      [false, "Sale"],
      [true, "Soon"],
      [true, null],
      [true, "terms"],
    ]);
    expect(menu.items[0]?.children[0]?.broken).toBe(false);
    const updated = await controller.updateMenu({
      tenantId: T,
      handle: "sale",
      title: "Deals",
      items: [],
      expectedVersion: 1,
    });
    expect(updated).toMatchObject({ status: 200, body: { title: "Deals", version: 2 } });
    expect(await controller.deleteMenu({ tenantId: T, handle: "sale" })).toMatchObject({
      status: 200,
    });
    expect((await controller.getMenu({ tenantId: T, handle: "sale" })).status).toBe(404);
  });

  it("the create and update answers are the same view a read gives, keys listed", async () => {
    const { controller } = harness({ targets: TARGETS });
    const created = await controller.createMenu({
      tenantId: T,
      handle: "sale",
      title: "Sale",
      items: [link(1, { type: "collection", id: "c-live" })],
    });
    const read = await controller.getMenu({ tenantId: T, handle: "sale" });
    expect(created.body).toEqual(read.body);
    expect(Object.keys(created.body as object).sort()).toEqual([
      "handle",
      "id",
      "isDefault",
      "items",
      "title",
      "version",
    ]);
    expect(created.body).toMatchObject({ id: "00000000-0000-7000-8000-000000000001" });
  });

  it("the limit counts custom menus only: saved defaults leave room for 50 (review M2)", async () => {
    const { controller } = harness();
    for (const handle of ["main-menu", "footer"]) {
      expect(
        await controller.updateMenu({
          tenantId: T,
          handle,
          title: "D",
          items: [],
          expectedVersion: 0,
        }),
      ).toMatchObject({ status: 200 });
    }
    for (let n = 1; n <= 50; n += 1) {
      const res = await controller.createMenu({
        tenantId: T,
        handle: `m-${n}`,
        title: "M",
        items: [],
      });
      expect(res.status).toBe(201);
    }
    expect(
      await controller.createMenu({ tenantId: T, handle: "one-more", title: "M", items: [] }),
    ).toMatchObject({ status: 409, body: { code: "MENU_LIMIT" } });
  });

  it("create counts menus and checks the handle without loading every menu (review M1)", async () => {
    const { controller, repos } = harness();
    await controller.createMenu({ tenantId: T, handle: "first", title: "F", items: [] });
    const list = vi.spyOn(repos.menus, "list");
    const count = vi.spyOn(repos.menus, "countCustom");
    expect(
      (await controller.createMenu({ tenantId: T, handle: "second", title: "S", items: [] }))
        .status,
    ).toBe(201);
    expect(list).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledWith(T);
  });

  it("refuses bad handles, taken handles, defaults, the reserved handle and the 51st menu", async () => {
    const { controller } = harness();
    const make = (handle: string) =>
      controller.createMenu({ tenantId: T, handle, title: "M", items: [] });
    expect(await make("Bad Handle")).toMatchObject({
      status: 422,
      body: { code: "INVALID_HANDLE" },
    });
    expect(await make("new")).toMatchObject({ status: 422, body: { code: "INVALID_HANDLE" } });
    expect(await make("main-menu")).toMatchObject({
      status: 409,
      body: { code: "MENU_HANDLE_TAKEN" },
    });
    expect((await make("a")).status).toBe(201);
    expect(await make("a")).toMatchObject({ status: 409, body: { code: "MENU_HANDLE_TAKEN" } });
    for (let n = 1; n < 50; n += 1) expect((await make(`m-${n}`)).status).toBe(201);
    expect(await make("one-more")).toMatchObject({ status: 409, body: { code: "MENU_LIMIT" } });
  });

  it("validates title and items before any write", async () => {
    const { controller, repos } = harness();
    const res = await controller.createMenu({
      tenantId: T,
      handle: "x",
      title: " ",
      items: [link(1, { type: "url", url: "javascript:alert(1)" })],
    });
    expect(res.status).toBe(422);
    expect((res.body as { fields: unknown[] }).fields).toEqual(
      expect.arrayContaining([
        { field: "title", message: "TITLE_REQUIRED" },
        { field: "items.0.link.url", message: "INVALID_URL" },
      ]),
    );
    expect(await repos.menus.get("x", T)).toBeNull();
  });

  it("an empty title alone is TITLE_REQUIRED; an over-long one is TOO_LONG", async () => {
    const { controller } = harness();
    expect(
      await controller.createMenu({ tenantId: T, handle: "x", title: " ", items: [] }),
    ).toMatchObject({
      status: 422,
      body: { code: "TITLE_REQUIRED", fields: [{ field: "title", message: "TITLE_REQUIRED" }] },
    });
    expect(
      await controller.createMenu({ tenantId: T, handle: "x", title: 7, items: [] }),
    ).toMatchObject({ status: 422, body: { code: "TITLE_REQUIRED" } });
    expect(
      await controller.updateMenu({
        tenantId: T,
        handle: "footer",
        title: "x".repeat(101),
        items: [],
        expectedVersion: 0,
      }),
    ).toMatchObject({ status: 422, body: { fields: [{ field: "title", message: "TOO_LONG" }] } });
  });

  it("the first save of a default inserts it; a lost first insert is VERSION_CONFLICT (Review Focus 4)", async () => {
    const { controller, repos } = harness();
    const first = await controller.updateMenu({
      tenantId: T,
      handle: "footer",
      title: "Footer",
      items: [],
      expectedVersion: 0,
    });
    expect(first).toMatchObject({ status: 200, body: { version: 1, isDefault: true } });
    expect((first.body as { id: string | null }).id).not.toBeNull();
    const second = await controller.updateMenu({
      tenantId: T,
      handle: "footer",
      title: "Other",
      items: [],
      expectedVersion: 0,
    });
    expect(second).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    expect((await repos.menus.list(T)).length).toBe(1);
  });

  it("a first insert that loses the race inside the unit of work is VERSION_CONFLICT, one row (preflight 21)", async () => {
    const { controller, repos } = harness();
    await controller.updateMenu({
      tenantId: T,
      handle: "footer",
      title: "Footer",
      items: [],
      expectedVersion: 0,
    });
    // The other request's insert lands between this request's read and its own insert.
    vi.spyOn(repos.menus, "get").mockResolvedValueOnce(null);
    const lost = await controller.updateMenu({
      tenantId: T,
      handle: "footer",
      title: "Mine",
      items: [],
      expectedVersion: 0,
    });
    expect(lost).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    const rows = await repos.menus.list(T);
    expect(rows.map((m) => m.snapshot().title)).toEqual(["Footer"]);
  });

  it("a create that loses the same-handle race is MENU_HANDLE_TAKEN, one row", async () => {
    const { controller, repos } = harness();
    await controller.createMenu({ tenantId: T, handle: "sale", title: "First", items: [] });
    // Both reads miss the first row: the pre-check, then the re-check inside the unit of work.
    vi.spyOn(repos.menus, "get").mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const lost = await controller.createMenu({
      tenantId: T,
      handle: "sale",
      title: "Second",
      items: [],
    });
    expect(lost).toMatchObject({ status: 409, body: { code: "MENU_HANDLE_TAKEN" } });
    expect((await repos.menus.list(T)).map((m) => m.snapshot().title)).toEqual(["First"]);
  });

  it("a stale update of a saved menu is VERSION_CONFLICT and changes nothing", async () => {
    const { controller, repos } = harness();
    await controller.createMenu({ tenantId: T, handle: "sale", title: "Sale", items: [] });
    expect(
      await controller.updateMenu({
        tenantId: T,
        handle: "sale",
        title: "Other",
        items: [],
        expectedVersion: 0,
      }),
    ).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    expect((await repos.menus.get("sale", T))?.snapshot().title).toBe("Sale");
  });

  it("a catalogue failure fails the save before anything is written", async () => {
    const options = { targets: TARGETS, linkTargetsFail: true };
    const { controller, repos } = harness(options);
    await expect(
      controller.createMenu({
        tenantId: T,
        handle: "sale",
        title: "Sale",
        items: [link(1, { type: "collection", id: "c-live" })],
      }),
    ).rejects.toThrow("catalogue down");
    expect(await repos.menus.get("sale", T)).toBeNull();
    // The admin read lets the failure surface too (Ruling 26), instead of showing broken links.
    options.linkTargetsFail = false;
    await controller.createMenu({
      tenantId: T,
      handle: "sale",
      title: "Sale",
      items: [link(1, { type: "collection", id: "c-live" })],
    });
    options.linkTargetsFail = true;
    await expect(controller.getMenu({ tenantId: T, handle: "sale" })).rejects.toThrow(
      "catalogue down",
    );
  });

  it("updating an unknown non-default menu is MENU_NOT_FOUND", async () => {
    const { controller } = harness();
    expect(
      await controller.updateMenu({
        tenantId: T,
        handle: "nope",
        title: "x",
        items: [],
        expectedVersion: 0,
      }),
    ).toMatchObject({ status: 404, body: { code: "MENU_NOT_FOUND" } });
  });

  it("the defaults cannot be deleted; a menu the draft or live theme uses cannot either", async () => {
    const { controller } = harness();
    expect(await controller.deleteMenu({ tenantId: T, handle: "footer" })).toMatchObject({
      status: 409,
      body: { code: "MENU_PROTECTED" },
    });
    await controller.createMenu({ tenantId: T, handle: "alt", title: "Alt", items: [] });
    const doc = {
      ...DEFAULT_THEME_DOCUMENT,
      header: { ...DEFAULT_THEME_DOCUMENT.header, menuHandle: "alt" },
    };
    await controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: doc });
    expect(await controller.deleteMenu({ tenantId: T, handle: "alt" })).toMatchObject({
      status: 409,
      body: { code: "MENU_IN_USE" },
    });
    expect(await controller.deleteMenu({ tenantId: T, handle: "missing" })).toMatchObject({
      status: 404,
      body: { code: "MENU_NOT_FOUND" },
    });
  });

  it("a menu only the live theme uses cannot be deleted", async () => {
    const { controller } = harness();
    await controller.createMenu({ tenantId: T, handle: "alt", title: "Alt", items: [] });
    const doc = {
      ...DEFAULT_THEME_DOCUMENT,
      footer: { ...DEFAULT_THEME_DOCUMENT.footer, menuHandle: "alt" },
    };
    await controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: doc });
    await controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "s" });
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 2,
      document: DEFAULT_THEME_DOCUMENT,
    });
    expect(await controller.deleteMenu({ tenantId: T, handle: "alt" })).toMatchObject({
      status: 409,
      body: { code: "MENU_IN_USE" },
    });
  });

  it("menus are per shop", async () => {
    const { controller } = harness();
    await controller.createMenu({ tenantId: T, handle: "sale", title: "Sale", items: [] });
    expect((await controller.getMenu({ tenantId: "t-2", handle: "sale" })).status).toBe(404);
  });

  it("link ids that name Object.prototype members are broken, never a target (preflight 12)", async () => {
    const { controller } = harness({ targets: TARGETS });
    await controller.createMenu({
      tenantId: T,
      handle: "proto",
      title: "Proto",
      items: [
        link(1, { type: "collection", id: "__proto__" }),
        link(2, { type: "product", id: "constructor" }),
        link(3, { type: "page", id: "toString" }),
      ],
    });
    const menu = (await controller.getMenu({ tenantId: T, handle: "proto" })).body as {
      items: { broken: boolean; targetTitle: string | null }[];
    };
    expect(menu.items.map((i) => [i.broken, i.targetTitle])).toEqual([
      [true, null],
      [true, null],
      [true, null],
    ]);
  });

  it("resolution reads own entries only: an inherited target is missing (preflight 12)", () => {
    const inherited = Object.create({
      "c-1": { href: "/collections/sale", title: "Sale", published: true },
    }) as Record<string, never>;
    const targets: LinkTargetMap = { collection: inherited, product: {}, page: {} };
    const items = [
      {
        id: ID(1),
        label: { en: "Sale" },
        link: { type: "collection" as const, id: "c-1" },
        children: [],
      },
    ];
    expect(resolveItems(items, targets, new Set())).toEqual([]);
    expect(itemViews(items, targets, new Set())).toMatchObject([
      { broken: true, targetTitle: null },
    ]);
  });

  it("link-target search: policies here, the rest through the port, at most 20, query trimmed", async () => {
    const { controller } = harness({ targets: TARGETS });
    const policies = (
      await controller.searchLinkTargets({ tenantId: T, type: "policy", q: " refund " })
    ).body;
    expect(policies).toEqual({
      targets: [{ id: "refund", title: "Refund policy", subtitle: "/policies/refund-policy" }],
    });
    const collections = (
      await controller.searchLinkTargets({ tenantId: T, type: "collection", q: "sa" })
    ).body as {
      targets: unknown[];
    };
    expect(collections.targets).toEqual([
      { id: "c-live", title: "Sale", subtitle: "/collections/sale" },
    ]);
  });

  it("policy search matches the slug and the Arabic title; an empty query lists all five", async () => {
    const { controller } = harness();
    const search = async (q: string) =>
      (
        (await controller.searchLinkTargets({ tenantId: T, type: "policy", q })).body as {
          targets: { id: string }[];
        }
      ).targets.map((t) => t.id);
    expect(await search("TERMS-of")).toEqual(["terms"]);
    expect(await search("الشحن")).toEqual(["shipping"]);
    expect(await search("")).toEqual(["refund", "shipping", "privacy", "terms", "contact"]);
  });

  it("asks the port with the trimmed query cut to 100 characters, and keeps the first 20", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 25 }, (_, n) => [
        `c-${n}`,
        { href: `/collections/c-${n}`, title: `Shoes ${n}`, published: true },
      ]),
    );
    const long = { href: "/collections/long", title: "s".repeat(100), published: true };
    const { controller } = harness({ targets: { [T]: { collection: { ...many, long } } } });
    const res = (
      await controller.searchLinkTargets({ tenantId: T, type: "collection", q: "  shoes " })
    ).body as { targets: unknown[] };
    expect(res.targets).toHaveLength(20);
    // 101 characters match nothing; cut to 100 they match exactly the long title.
    const cut = (
      await controller.searchLinkTargets({ tenantId: T, type: "collection", q: "s".repeat(101) })
    ).body as { targets: { id: string }[] };
    expect(cut.targets.map((t) => t.id)).toEqual(["long"]);
  });

  it("an unknown link type is refused", async () => {
    const { controller } = harness();
    expect(
      await controller.searchLinkTargets({ tenantId: T, type: "url" as never, q: "" }),
    ).toMatchObject({
      status: 422,
      body: { fields: [{ field: "type", message: "INVALID_VALUE" }] },
    });
  });
});
