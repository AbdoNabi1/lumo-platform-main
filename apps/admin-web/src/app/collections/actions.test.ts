import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({
  createCollection: vi.fn(),
  renameCollection: vi.fn(),
  addCollectionProduct: vi.fn(),
  removeCollectionProduct: vi.fn(),
  reorderCollectionProducts: vi.fn(),
  publishCollection: vi.fn(),
  unpublishCollection: vi.fn(),
  deleteCollection: vi.fn(),
  fetchProductsPage: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());
const cookieLocale = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("@/lib/api/collections", () => ({
  createCollection: api.createCollection,
  renameCollection: api.renameCollection,
  addCollectionProduct: api.addCollectionProduct,
  removeCollectionProduct: api.removeCollectionProduct,
  reorderCollectionProducts: api.reorderCollectionProducts,
  publishCollection: api.publishCollection,
  unpublishCollection: api.unpublishCollection,
  deleteCollection: api.deleteCollection,
}));
vi.mock("@/lib/api/products", () => ({ fetchProductsPage: api.fetchProductsPage }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieLocale.value === undefined ? undefined : { value: cookieLocale.value }),
  }),
}));

const {
  addCollectionProductAction,
  createCollectionAction,
  deleteCollectionAction,
  moveCollectionProductAction,
  removeCollectionProductAction,
  renameCollectionAction,
  searchCollectionProductsAction,
  setCollectionStatusAction,
} = await import("./actions");

const IDLE: FormState = { status: "idle" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = "c-1";

function form(fields: Record<string, string | readonly string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of typeof value === "string" ? [value] : value) data.append(key, entry);
  }
  return data;
}

const ok = { outcome: "ok", data: {} } as const;
const conflict = { outcome: "conflict", message: "Already published", code: "BUSINESS_RULE" };

beforeEach(() => {
  expect.hasAssertions();
  cookieLocale.value = undefined;
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("createCollectionAction", () => {
  it("creates with a fresh idempotency key, revalidates, then opens the new collection", async () => {
    api.createCollection.mockResolvedValue({ outcome: "ok", data: { id: "c-9" } });

    await createCollectionAction(IDLE, form({ name: "  Summer ", slug: " summer " }));

    expect(api.createCollection).toHaveBeenCalledWith(
      { name: "Summer", slug: "summer" },
      expect.stringMatching(UUID),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/collections");
    expect(revalidatePath).toHaveBeenCalledWith("/collections/c-9");
    expect(redirect).toHaveBeenCalledWith("/collections/c-9");
  });

  it("makes no API call and no revalidation for an empty title or handle", async () => {
    const state = await createCollectionAction(IDLE, form({ name: "", slug: "" }));

    expect(state).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { name: en.formErrors.invalid, slug: en.formErrors.invalid },
    });
    expect(api.createCollection).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("surfaces a duplicate handle (409) and still revalidates the list", async () => {
    api.createCollection.mockResolvedValue({
      outcome: "conflict",
      message: "Slug already in use",
      code: "CONFLICT",
    });

    const state = await createCollectionAction(IDLE, form({ name: "Summer", slug: "summer" }));

    expect(state).toEqual({ status: "error", message: "Slug already in use", fieldErrors: {} });
    expect(revalidatePath).toHaveBeenCalledWith("/collections");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("keeps the API's field issues next to the inputs (422)", async () => {
    api.createCollection.mockResolvedValue({
      outcome: "invalid",
      message: "Validation failed",
      fields: [{ field: "slug", message: "Invalid handle" }],
    });

    const state = await createCollectionAction(IDLE, form({ name: "Summer", slug: "Sum mer" }));

    expect(state).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { slug: "Invalid handle" },
    });
  });
});

describe("moveCollectionProductAction", () => {
  it("moves b up in [a,b,c] and sends the complete permutation [b,a,c]", async () => {
    api.reorderCollectionProducts.mockResolvedValue(ok);

    const state = await moveCollectionProductAction(
      IDLE,
      form({ collectionId: ID, productId: "b", direction: "up", productIds: ["a", "b", "c"] }),
    );

    expect(state).toEqual({ status: "success" });
    expect(api.reorderCollectionProducts).toHaveBeenCalledWith(
      ID,
      ["b", "a", "c"],
      expect.stringMatching(UUID),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/collections");
    expect(revalidatePath).toHaveBeenCalledWith(`/collections/${ID}`);
  });

  it("moves b down in [a,b,c] to [a,c,b]", async () => {
    api.reorderCollectionProducts.mockResolvedValue(ok);

    await moveCollectionProductAction(
      IDLE,
      form({ collectionId: ID, productId: "b", direction: "down", productIds: ["a", "b", "c"] }),
    );

    expect(api.reorderCollectionProducts).toHaveBeenCalledWith(
      ID,
      ["a", "c", "b"],
      expect.any(String),
    );
  });

  it("refuses to move the first member up: error state, no API call, nothing to revalidate", async () => {
    const state = await moveCollectionProductAction(
      IDLE,
      form({ collectionId: ID, productId: "a", direction: "up", productIds: ["a", "b", "c"] }),
    );

    expect(state).toEqual({
      status: "error",
      message: en.collections.errors.alreadyFirst,
      fieldErrors: {},
    });
    expect(api.reorderCollectionProducts).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses to move the last member down, in the shop's own language", async () => {
    cookieLocale.value = "ar";

    const state = await moveCollectionProductAction(
      IDLE,
      form({ collectionId: ID, productId: "c", direction: "down", productIds: ["a", "b", "c"] }),
    );

    expect(state).toEqual({
      status: "error",
      message: ar.collections.errors.alreadyLast,
      fieldErrors: {},
    });
    expect(api.reorderCollectionProducts).not.toHaveBeenCalled();
  });

  it("refuses a product that is not in the submitted list, and a bad direction", async () => {
    const missing = await moveCollectionProductAction(
      IDLE,
      form({ collectionId: ID, productId: "z", direction: "up", productIds: ["a", "b"] }),
    );
    expect(missing).toMatchObject({
      status: "error",
      message: en.collections.errors.notInCollection,
    });

    const sideways = await moveCollectionProductAction(
      IDLE,
      form({ collectionId: ID, productId: "a", direction: "left", productIds: ["a", "b"] }),
    );
    expect(sideways).toMatchObject({ status: "error", message: en.formErrors.invalid });
    expect(api.reorderCollectionProducts).not.toHaveBeenCalled();
  });

  it("swaps across what would be a page boundary: member 51 up in a 51-member list", async () => {
    api.reorderCollectionProducts.mockResolvedValue(ok);
    const ids = Array.from({ length: 51 }, (_, i) => `p-${i + 1}`);

    await moveCollectionProductAction(
      IDLE,
      form({ collectionId: ID, productId: "p-51", direction: "up", productIds: ids }),
    );

    const sent = api.reorderCollectionProducts.mock.calls[0]?.[1] as string[];
    expect(sent).toHaveLength(51);
    expect(sent.slice(48)).toEqual(["p-49", "p-51", "p-50"]);
    expect(sent.slice(0, 48)).toEqual(ids.slice(0, 48));
  });
});

describe("every write that reached the API revalidates both paths, ok or not", () => {
  const writes: readonly [
    string,
    (state: FormState, data: FormData) => Promise<FormState>,
    ReturnType<typeof vi.fn>,
    FormData,
  ][] = [
    [
      "rename",
      renameCollectionAction,
      api.renameCollection,
      form({ collectionId: ID, name: "Winter" }),
    ],
    [
      "publish",
      setCollectionStatusAction,
      api.publishCollection,
      form({ collectionId: ID, value: "published" }),
    ],
    [
      "unpublish",
      setCollectionStatusAction,
      api.unpublishCollection,
      form({ collectionId: ID, value: "draft" }),
    ],
    [
      "add",
      addCollectionProductAction,
      api.addCollectionProduct,
      form({ collectionId: ID, productId: "p-1" }),
    ],
    [
      "remove",
      removeCollectionProductAction,
      api.removeCollectionProduct,
      form({ collectionId: ID, productId: "p-1" }),
    ],
    [
      "move",
      moveCollectionProductAction,
      api.reorderCollectionProducts,
      form({ collectionId: ID, productId: "b", direction: "up", productIds: ["a", "b"] }),
    ],
    ["delete", deleteCollectionAction, api.deleteCollection, form({ collectionId: ID })],
  ];

  it.each(writes)("%s", async (_name, action, apiFn, data) => {
    for (const result of [
      conflict,
      { outcome: "forbidden" },
      { outcome: "not_found" },
      { outcome: "error", message: "boom" },
      { outcome: "unauthorized" },
    ]) {
      revalidatePath.mockClear();
      apiFn.mockResolvedValueOnce(result);

      const state = await action(IDLE, data);

      expect(state.status, JSON.stringify(result)).toBe("error");
      expect(revalidatePath).toHaveBeenCalledWith("/collections");
      expect(revalidatePath).toHaveBeenCalledWith(`/collections/${ID}`);
    }
  });

  it("passes the right ids and a fresh key to the API", async () => {
    api.publishCollection.mockResolvedValue(ok);
    api.unpublishCollection.mockResolvedValue(ok);
    api.addCollectionProduct.mockResolvedValue(ok);
    api.removeCollectionProduct.mockResolvedValue(ok);
    api.renameCollection.mockResolvedValue(ok);

    await setCollectionStatusAction(IDLE, form({ collectionId: ID, value: "published" }));
    await setCollectionStatusAction(IDLE, form({ collectionId: ID, value: "draft" }));
    await addCollectionProductAction(IDLE, form({ collectionId: ID, productId: "p-1" }));
    await removeCollectionProductAction(IDLE, form({ collectionId: ID, productId: "p-2" }));
    await renameCollectionAction(IDLE, form({ collectionId: ID, name: " Winter " }));

    expect(api.publishCollection).toHaveBeenCalledWith(ID, expect.stringMatching(UUID));
    expect(api.unpublishCollection).toHaveBeenCalledWith(ID, expect.stringMatching(UUID));
    expect(api.addCollectionProduct).toHaveBeenCalledWith(ID, "p-1", expect.stringMatching(UUID));
    expect(api.removeCollectionProduct).toHaveBeenCalledWith(
      ID,
      "p-2",
      expect.stringMatching(UUID),
    );
    expect(api.renameCollection).toHaveBeenCalledWith(ID, "Winter", expect.stringMatching(UUID));
  });

  it("makes no call for malformed forms", async () => {
    await renameCollectionAction(IDLE, form({ collectionId: ID, name: "  " }));
    await setCollectionStatusAction(IDLE, form({ collectionId: ID, value: "archived" }));
    await addCollectionProductAction(IDLE, form({ collectionId: "", productId: "p" }));
    await removeCollectionProductAction(IDLE, form({ collectionId: ID }));
    await deleteCollectionAction(IDLE, form({}));

    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteCollectionAction", () => {
  it("API 409 → error state, and revalidatePath still runs for both paths", async () => {
    api.deleteCollection.mockResolvedValue({
      outcome: "conflict",
      message: "Cannot delete",
      code: "BUSINESS_RULE",
    });

    const state = await deleteCollectionAction(IDLE, form({ collectionId: ID }));

    expect(state).toEqual({ status: "error", message: "Cannot delete", fieldErrors: {} });
    expect(revalidatePath).toHaveBeenCalledWith("/collections");
    expect(revalidatePath).toHaveBeenCalledWith(`/collections/${ID}`);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("ok → revalidates, then redirects to /collections", async () => {
    api.deleteCollection.mockResolvedValue(ok);

    await deleteCollectionAction(IDLE, form({ collectionId: ID }));

    expect(api.deleteCollection).toHaveBeenCalledWith(ID, expect.stringMatching(UUID));
    expect(revalidatePath).toHaveBeenCalledWith("/collections");
    expect(revalidatePath).toHaveBeenCalledWith(`/collections/${ID}`);
    expect(redirect).toHaveBeenCalledWith("/collections");
  });
});

describe("searchCollectionProductsAction", () => {
  const item = (id: string, name: string, status: string) => ({
    id,
    sku: id,
    name,
    slug: id,
    status,
    variantCount: 1,
    priceAmountMinor: 100,
    currency: "EGP",
  });

  it("lists every product, draft and published alike, as { id, name, status }", async () => {
    api.fetchProductsPage.mockResolvedValue({
      outcome: "ok",
      items: [
        item("p-1", "Draft tee", "draft"),
        item("p-2", "Live cap", "published"),
        item("p-3", "Old hat", "archived"),
        item("p-4", "Soon", "scheduled"),
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    });

    const found = await searchCollectionProductsAction("  tee ");

    expect(api.fetchProductsPage).toHaveBeenCalledWith({ first: 50, query: "tee" });
    expect(found).toEqual([
      { id: "p-1", name: "Draft tee", status: "draft" },
      { id: "p-2", name: "Live cap", status: "published" },
      { id: "p-3", name: "Old hat", status: "archived" },
      { id: "p-4", name: "Soon", status: "scheduled" },
    ]);
  });

  it("sends no query for an empty search, caps the query at 100 chars and the list at 20", async () => {
    api.fetchProductsPage.mockResolvedValue({
      outcome: "ok",
      items: Array.from({ length: 30 }, (_, i) => item(`p-${i}`, `P${i}`, "draft")),
      pageInfo: { hasNextPage: true, endCursor: "x" },
    });

    expect(await searchCollectionProductsAction("   ")).toHaveLength(20);
    expect(api.fetchProductsPage).toHaveBeenLastCalledWith({ first: 50 });

    await searchCollectionProductsAction("x".repeat(150));
    expect(api.fetchProductsPage).toHaveBeenLastCalledWith({ first: 50, query: "x".repeat(100) });

    await searchCollectionProductsAction(undefined as unknown as string);
    expect(api.fetchProductsPage).toHaveBeenLastCalledWith({ first: 50 });
  });

  it("returns [] when the products API does not answer ok", async () => {
    api.fetchProductsPage.mockResolvedValue({ outcome: "unauthorized" });
    expect(await searchCollectionProductsAction("tee")).toEqual([]);
    api.fetchProductsPage.mockResolvedValue({ outcome: "error", message: "boom" });
    expect(await searchCollectionProductsAction("tee")).toEqual([]);
  });
});
