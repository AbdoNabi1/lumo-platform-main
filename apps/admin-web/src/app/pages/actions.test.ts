import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({
  createPage: vi.fn(),
  advancePage: vi.fn(),
  updatePageContent: vi.fn(),
}));
const revalidate = vi.hoisted(() => ({ revalidateStorefront: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/api/pages", () => api);
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
const { advancePageAction, createPageAction, savePageContentAction } = await import("./actions");

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const idle = { status: "idle" } as const;
const content = {
  title: { en: "About" },
  body: { en: "## Hi" },
  metaDescription: { en: "Who we are" },
  expectedVersion: 2,
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  revalidate.revalidateStorefront.mockReset().mockResolvedValue(true);
  revalidate.revalidatePath.mockReset();
});

describe("page actions (spec 2.4)", () => {
  it("create sends the title as the name, the content and the route path in one call", async () => {
    api.createPage.mockResolvedValue({ outcome: "ok", data: { id: "p-9" } });
    await expect(
      createPageAction(
        idle,
        form({
          "title.ar": "",
          "title.en": "  About us ",
          "body.ar": "نص",
          "body.en": "",
          routePath: " /pages/about-us ",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/pages/p-9");
    expect(api.createPage).toHaveBeenCalledTimes(1);
    expect(api.createPage).toHaveBeenCalledWith(
      {
        name: "About us",
        routePath: "/pages/about-us",
        title: { en: "  About us " },
        body: { ar: "نص" },
      },
      expect.any(String),
    );
    expect(revalidate.revalidatePath).toHaveBeenCalledWith("/pages");
  });

  it("create without a title or an address says which field, without calling the API", async () => {
    const state = await createPageAction(idle, form({ "title.ar": " ", routePath: "" }));
    expect(state).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { title: en.pageEditor.titleRequired, routePath: en.pageEditor.addressInvalid },
    });
    expect(api.createPage).not.toHaveBeenCalled();
  });

  it("a taken address is shown on the address field (F14)", async () => {
    api.createPage.mockResolvedValue({
      outcome: "conflict",
      message: 'ROUTE_PATH_TAKEN: Page for route "/pages/about" already exists',
    });
    const state = await createPageAction(
      idle,
      form({ "title.en": "About", routePath: "/pages/about" }),
    );
    expect(state).toMatchObject({ fieldErrors: { routePath: en.pageEditor.addressTaken } });
  });

  it("an address the API refuses gets our address copy, never the server's English", async () => {
    api.createPage.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid route path",
      fields: [{ field: "routePath", message: "must be a lowercase slash-separated path" }],
    });
    const state = await createPageAction(idle, form({ "title.en": "About", routePath: "/Pages" }));
    expect(state).toMatchObject({ fieldErrors: { routePath: en.pageEditor.addressInvalid } });
  });

  it("saving content sends the version with one key and revalidates the storefront", async () => {
    api.updatePageContent.mockResolvedValue({ outcome: "ok", data: { pageId: "p-1", version: 3 } });
    expect(await savePageContentAction("p-1", content)).toEqual({ status: "success", version: 3 });
    expect(api.updatePageContent).toHaveBeenCalledWith("p-1", content, expect.any(String));
    expect(revalidate.revalidatePath).toHaveBeenCalledWith("/pages/p-1");
    expect(revalidate.revalidateStorefront).toHaveBeenCalledTimes(1);
    revalidate.revalidateStorefront.mockResolvedValue(false);
    expect(await savePageContentAction("p-1", content)).toEqual({
      status: "success",
      liveDelayed: true,
      version: 3,
    });
    const keys = api.updatePageContent.mock.calls.map((call) => call[2] as string);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("saving refuses a bad version or page id without calling the API", async () => {
    expect(await savePageContentAction("p-1", { ...content, expectedVersion: 1.5 })).toMatchObject({
      status: "error",
    });
    expect(await savePageContentAction("", content)).toMatchObject({ status: "error" });
    expect(api.updatePageContent).not.toHaveBeenCalled();
  });

  it("publishing or hiding a page revalidates the storefront", async () => {
    api.advancePage.mockResolvedValue({ outcome: "ok", data: {} });
    expect(await advancePageAction("p-1", "published")).toEqual({ status: "success" });
    expect(await advancePageAction("p-1", "draft")).toEqual({ status: "success" });
    expect(api.advancePage).toHaveBeenNthCalledWith(1, "p-1", "published", expect.any(String));
    expect(api.advancePage).toHaveBeenNthCalledWith(2, "p-1", "draft", expect.any(String));
    expect(revalidate.revalidateStorefront).toHaveBeenCalledTimes(2);
    expect(revalidate.revalidatePath).toHaveBeenCalledWith("/pages/p-1");
    expect(await advancePageAction("p-1", "deleted")).toMatchObject({ status: "error" });
    expect(api.advancePage).toHaveBeenCalledTimes(2);
  });

  it("VERSION_CONFLICT and PAGE_ARCHIVED map to their copy", async () => {
    api.updatePageContent.mockResolvedValue({
      outcome: "conflict",
      message: "VERSION_CONFLICT: This page was changed in another window. Reload to continue.",
    });
    expect(await savePageContentAction("p-1", content)).toEqual({
      status: "error",
      message: en.onlineStorePreferences.conflict,
      fieldErrors: {},
    });
    api.updatePageContent.mockResolvedValue({
      outcome: "conflict",
      message: "PAGE_ARCHIVED: An archived page cannot be edited.",
    });
    expect(await savePageContentAction("p-1", content)).toMatchObject({
      message: en.pageEditor.archived,
    });
    api.advancePage.mockResolvedValue({
      outcome: "conflict",
      message: "VERSION_CONFLICT: This page was changed in another window. Reload to continue.",
    });
    expect(await advancePageAction("p-1", "published")).toMatchObject({
      message: en.onlineStorePreferences.conflict,
    });
    expect(revalidate.revalidateStorefront).not.toHaveBeenCalled();
  });

  it("an unsafe link in the content lands on its locale's field", async () => {
    api.updatePageContent.mockResolvedValue({
      outcome: "invalid",
      message: "INVALID_CONTENT: Check the highlighted fields.",
      fields: [{ field: "body.ar", message: "UNSAFE_LINK" }],
    });
    expect(await savePageContentAction("p-1", content)).toMatchObject({
      fieldErrors: { "body.ar": en.richText.unsafeLinkSaved },
    });
  });
});
