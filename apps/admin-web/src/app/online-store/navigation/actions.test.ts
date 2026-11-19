import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItem } from "@platform/storefront-content";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({
  createMenu: vi.fn(),
  updateMenu: vi.fn(),
  deleteMenu: vi.fn(),
  searchLinkTargets: vi.fn(),
}));
const revalidate = vi.hoisted(() => ({ revalidateStorefront: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/api/online-store", () => api);
vi.mock("@/lib/storefront-revalidate", () => ({
  revalidateStorefront: revalidate.revalidateStorefront,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
const { createMenuAction, deleteMenuAction, saveMenuAction, searchLinkTargetsAction } =
  await import("./actions");

const n = en.onlineStoreNavigation;
const ID = "0b0e7a3c-4f6a-4c1e-9d55-6f1a2b3c4d5e";
const items: MenuItem[] = [{ id: ID, label: { en: "Home" }, link: { type: "home" }, children: [] }];
const menuDto = {
  id: "m-1",
  handle: "main-menu",
  title: "Main",
  isDefault: true,
  version: 3,
  items: [{ ...items[0]!, broken: false, targetTitle: null, children: [] }],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  revalidate.revalidateStorefront.mockReset().mockResolvedValue(true);
  revalidate.revalidatePath.mockReset();
});

describe("menu actions", () => {
  it("save sends title, items and the version with one key, then revalidates the storefront", async () => {
    api.updateMenu.mockResolvedValue({ outcome: "ok", data: menuDto });
    const state = await saveMenuAction({
      handle: "main-menu",
      title: "Main",
      items,
      expectedVersion: 2,
    });
    expect(api.updateMenu).toHaveBeenCalledWith(
      "main-menu",
      { title: "Main", items, expectedVersion: 2 },
      expect.any(String),
    );
    expect(state).toEqual({ status: "success", menu: menuDto });
    expect(revalidate.revalidateStorefront).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidatePath).toHaveBeenCalledWith("/online-store/navigation");
    expect(revalidate.revalidatePath).toHaveBeenCalledWith("/online-store/navigation/main-menu");
  });

  it("each save gets its own idempotency key", async () => {
    api.updateMenu.mockResolvedValue({ outcome: "ok", data: menuDto });
    const input = { handle: "main-menu", title: "Main", items, expectedVersion: 2 };
    await saveMenuAction(input);
    await saveMenuAction(input);
    const keys = api.updateMenu.mock.calls.map((call) => call[2] as string);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("a refused revalidation still saves, with liveDelayed", async () => {
    api.updateMenu.mockResolvedValue({ outcome: "ok", data: menuDto });
    revalidate.revalidateStorefront.mockResolvedValue(false);
    const state = await saveMenuAction({
      handle: "main-menu",
      title: "Main",
      items,
      expectedVersion: 2,
    });
    expect(state).toEqual({ status: "success", menu: menuDto, liveDelayed: true });
  });

  it("never sends a version that is not a non-negative integer, nor a malformed handle", async () => {
    for (const expectedVersion of [-1, 1.5, Number.NaN]) {
      const state = await saveMenuAction({ handle: "footer", title: "F", items, expectedVersion });
      expect(state).toMatchObject({ status: "error", message: en.formErrors.invalid });
    }
    expect(
      await saveMenuAction({ handle: "../x", title: "F", items, expectedVersion: 0 }),
    ).toMatchObject({ status: "error" });
    expect(api.updateMenu).not.toHaveBeenCalled();
  });

  it("maps MENU_IN_USE, MENU_PROTECTED and VERSION_CONFLICT to their copy", async () => {
    api.deleteMenu.mockResolvedValue({ outcome: "conflict", message: "MENU_IN_USE: shown" });
    expect(await deleteMenuAction("alt")).toEqual({
      status: "error",
      message: n.inUse,
      fieldErrors: {},
    });
    api.deleteMenu.mockResolvedValue({ outcome: "conflict", message: "MENU_PROTECTED: no" });
    expect(await deleteMenuAction("footer")).toMatchObject({ message: n.protected });
    api.updateMenu.mockResolvedValue({ outcome: "conflict", message: "VERSION_CONFLICT: x" });
    expect(
      await saveMenuAction({ handle: "footer", title: "F", items, expectedVersion: 1 }),
    ).toMatchObject({ message: en.onlineStorePreferences.conflict });
    expect(revalidate.revalidateStorefront).not.toHaveBeenCalled();
  });

  it("delete sends the handle with a key and no body, then goes back to the list", async () => {
    api.deleteMenu.mockResolvedValue({ outcome: "ok", data: { handle: "sale" } });
    await expect(deleteMenuAction("sale")).rejects.toThrow("REDIRECT:/online-store/navigation");
    expect(api.deleteMenu).toHaveBeenCalledWith("sale", expect.any(String));
    expect(revalidate.revalidateStorefront).toHaveBeenCalledTimes(1);
  });

  it("maps an INVALID_URL item field to the web-address copy", async () => {
    api.updateMenu.mockResolvedValue({
      outcome: "invalid",
      message: "INVALID_CONTENT: Check the highlighted fields.",
      fields: [{ field: "items.0.link.url", message: "INVALID_URL" }],
    });
    const state = await saveMenuAction({ handle: "footer", title: "F", items, expectedVersion: 1 });
    expect(state).toMatchObject({ fieldErrors: { "items.0.link.url": n.urlError } });
  });

  it("an oversized menu (422 INVALID_CONTENT, items: MENU_TOO_LARGE) says so in the message", async () => {
    api.updateMenu.mockResolvedValue({
      outcome: "invalid",
      message: "INVALID_CONTENT: Check the highlighted fields.",
      fields: [{ field: "items", message: "MENU_TOO_LARGE" }],
    });
    const state = await saveMenuAction({ handle: "footer", title: "F", items, expectedVersion: 1 });
    expect(state).toEqual({
      status: "error",
      message: n.tooLarge,
      fieldErrors: { items: n.tooLarge },
    });
  });

  it("create redirects to the new menu", async () => {
    api.createMenu.mockResolvedValue({ outcome: "ok", data: { ...menuDto, handle: "sale" } });
    await expect(createMenuAction({ handle: "sale", title: "Sale", items: [] })).rejects.toThrow(
      "REDIRECT:/online-store/navigation/sale",
    );
    expect(api.createMenu).toHaveBeenCalledWith(
      { handle: "sale", title: "Sale", items: [] },
      expect.any(String),
    );
    expect(revalidate.revalidateStorefront).toHaveBeenCalledTimes(1);
  });

  it("create maps a taken handle and the menu limit to their copy", async () => {
    api.createMenu.mockResolvedValue({ outcome: "conflict", message: "MENU_HANDLE_TAKEN: x" });
    expect(await createMenuAction({ handle: "sale", title: "S", items: [] })).toMatchObject({
      message: n.taken,
    });
    api.createMenu.mockResolvedValue({ outcome: "conflict", message: "MENU_LIMIT: x" });
    expect(await createMenuAction({ handle: "sale", title: "S", items: [] })).toMatchObject({
      message: n.limit,
    });
  });

  it("link-target search never throws: a failure is an empty list", async () => {
    api.searchLinkTargets.mockResolvedValue({ outcome: "error", message: "down" });
    expect(await searchLinkTargetsAction("collection", "sa")).toEqual([]);
    api.searchLinkTargets.mockRejectedValue(new Error("boom"));
    expect(await searchLinkTargetsAction("collection", "sa")).toEqual([]);
  });

  it("link-target search passes the type through and refuses an unknown one", async () => {
    const targets = [{ id: "c-1", title: "Sale", subtitle: "/collections/sale" }];
    api.searchLinkTargets.mockResolvedValue({ outcome: "ok", data: targets });
    expect(await searchLinkTargetsAction("product", "  sa ")).toEqual(targets);
    expect(api.searchLinkTargets).toHaveBeenCalledWith("product", "sa");
    expect(await searchLinkTargetsAction("menu" as "page", "")).toEqual([]);
    expect(api.searchLinkTargets).toHaveBeenCalledTimes(1);
  });
});

describe("menu actions refuse a malformed argument (a server action is a public endpoint)", () => {
  const invalid = { status: "error", message: en.formErrors.invalid, fieldErrors: {} };
  const bad: unknown[] = [
    null,
    undefined,
    "main-menu",
    42,
    { handle: "main-menu", title: 7, items, expectedVersion: 1 },
    { handle: "main-menu", title: "Main", items: "nope", expectedVersion: 1 },
    { handle: "main-menu", title: "Main", expectedVersion: 1 },
  ];

  it.each(bad)("save answers invalid and never calls the API (%j)", async (input) => {
    const state = await saveMenuAction(input as never);
    expect(state).toMatchObject({ status: "error", message: en.formErrors.invalid });
    expect(api.updateMenu).not.toHaveBeenCalled();
  });

  it.each(bad)("create answers invalid and never calls the API (%j)", async (input) => {
    const state = await createMenuAction(input as never);
    expect(state).toMatchObject({ status: "error", message: en.formErrors.invalid });
    expect(api.createMenu).not.toHaveBeenCalled();
  });

  it("delete refuses a non-string handle", async () => {
    expect(await deleteMenuAction(null as never)).toEqual(invalid);
    expect(api.deleteMenu).not.toHaveBeenCalled();
  });
});
