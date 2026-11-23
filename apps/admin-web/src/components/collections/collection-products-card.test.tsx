import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CollectionMemberDto } from "@/lib/api/collections";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

// The card runs the REAL server actions; only the network edge and Next's runtime are faked, so
// what these tests prove is what the API client would actually be asked to do.
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
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { CollectionProductsCard } = await import("./collection-products-card");

const COLLECTION = "c-1";
const ok = { outcome: "ok", data: {} };
const body = () => within(document.body);

/** A 51-member collection: p-1 … p-51. */
const ALL_IDS = Array.from({ length: 51 }, (_, i) => `p-${i + 1}`);

function member(n: number, overrides: Partial<CollectionMemberDto> = {}): CollectionMemberDto {
  return {
    productId: `p-${n}`,
    position: n - 1,
    name: `Product ${n}`,
    status: "published",
    missing: false,
    ...overrides,
  };
}

function renderCard(
  props: Partial<Parameters<typeof CollectionProductsCard>[0]> & { t?: Dictionary } = {},
) {
  return render(
    <CollectionProductsCard
      collectionId={COLLECTION}
      productIds={ALL_IDS}
      members={[member(51)]}
      membersPage={2}
      hasNextPage={false}
      t={en}
      {...props}
    />,
  );
}

const k = en.collections.products;
const label = (template: string, name: string) => template.replace("{name}", name);

beforeEach(() => {
  expect.hasAssertions();
  for (const fn of Object.values(api)) fn.mockReset();
  revalidatePath.mockReset();
  api.reorderCollectionProducts.mockResolvedValue(ok);
  api.removeCollectionProduct.mockResolvedValue(ok);
  api.addCollectionProduct.mockResolvedValue(ok);
});

describe("CollectionProductsCard — rows", () => {
  it("lists members in the order given, names in <bdi dir=auto>, with positions and statuses", () => {
    renderCard({
      productIds: ["p-1", "p-2", "p-3"],
      members: [
        member(1, { name: "Linen shirt", status: "draft" }),
        member(2, { name: "مقعد خشبي", status: "published" }),
        member(3, { name: "Cap", status: "archived" }),
      ],
      membersPage: 1,
    });

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("1Linen shirt" + en.productStatus.draft);
    expect(rows[1]).toHaveTextContent("مقعد خشبي" + en.productStatus.published);
    expect(rows[2]).toHaveTextContent("3Cap" + en.productStatus.archived);
    for (const row of rows) expect(row.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows a 'Product deleted' label for a missing member, which can still be removed", async () => {
    renderCard({
      productIds: ["p-1", "gone"],
      members: [
        member(1),
        { productId: "gone", position: 1, name: null, status: null, missing: true },
      ],
      membersPage: 1,
    });

    expect(screen.getByText(k.deleted)).toBeVisible();
    const remove = screen.getByRole("button", { name: label(k.remove, k.deleted) });
    expect(remove).toBeEnabled();
    fireEvent.click(remove);

    await waitFor(() =>
      expect(api.removeCollectionProduct).toHaveBeenCalledWith(
        COLLECTION,
        "gone",
        expect.any(String),
      ),
    );
  });

  it("says so when there are no products, and when the members could not be loaded", () => {
    const { unmount } = renderCard({ productIds: [], members: [], membersPage: 1 });
    expect(screen.getByText(k.empty)).toBeVisible();
    unmount();

    renderCard({ productIds: ["p-1"], members: [], membersPage: 1, loadFailed: true });
    expect(screen.getByRole("alert")).toHaveTextContent(k.loadError);
    expect(screen.queryByText(k.empty)).toBeNull();
  });

  it("disables Move up on the collection's first member and Move down on its last", () => {
    renderCard({
      productIds: ["p-1", "p-2", "p-3"],
      members: [member(1), member(2), member(3)],
      membersPage: 1,
    });

    expect(screen.getByRole("button", { name: label(k.moveUp, "Product 1") })).toBeDisabled();
    expect(screen.getByRole("button", { name: label(k.moveDown, "Product 1") })).toBeEnabled();
    expect(screen.getByRole("button", { name: label(k.moveUp, "Product 3") })).toBeEnabled();
    expect(screen.getByRole("button", { name: label(k.moveDown, "Product 3") })).toBeDisabled();
  });
});

describe("CollectionProductsCard — 51 members, page 2 (finding 5)", () => {
  it("shows member 51, a Previous link to page 1 and no Next link", () => {
    renderCard();

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Product 51")).toBeVisible();
    expect(screen.getByRole("link", { name: new RegExp(k.previous) })).toHaveAttribute(
      "href",
      "/collections/c-1?membersPage=1",
    );
    expect(screen.queryByRole("link", { name: new RegExp(k.next) })).toBeNull();
    expect(screen.getByText(k.page.replace("{n}", "2"))).toBeVisible();
  });

  it("page 1 offers Next (?membersPage=2) and no Previous", () => {
    renderCard({
      members: Array.from({ length: 50 }, (_, i) => member(i + 1)),
      membersPage: 1,
      hasNextPage: true,
    });

    expect(screen.getByRole("link", { name: new RegExp(k.next) })).toHaveAttribute(
      "href",
      "/collections/c-1?membersPage=2",
    );
    expect(screen.queryByRole("link", { name: new RegExp(k.previous) })).toBeNull();
  });

  it("Remove on member 51 calls removeCollectionProduct with its id", async () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: label(k.remove, "Product 51") }));

    await waitFor(() => expect(api.removeCollectionProduct).toHaveBeenCalledTimes(1));
    expect(api.removeCollectionProduct).toHaveBeenCalledWith(
      COLLECTION,
      "p-51",
      expect.any(String),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/collections");
    expect(revalidatePath).toHaveBeenCalledWith(`/collections/${COLLECTION}`);
  });

  it("Move up on member 51 sends the full 51-id permutation with 50 and 51 swapped", async () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: label(k.moveUp, "Product 51") }));

    await waitFor(() => expect(api.reorderCollectionProducts).toHaveBeenCalledTimes(1));
    const [id, sent] = api.reorderCollectionProducts.mock.calls[0] as [string, string[]];
    expect(id).toBe(COLLECTION);
    expect(sent).toHaveLength(51);
    expect(new Set(sent)).toEqual(new Set(ALL_IDS));
    expect(sent.slice(0, 49)).toEqual(ALL_IDS.slice(0, 49));
    expect(sent.slice(49)).toEqual(["p-51", "p-50"]);
  });

  it("Move down on member 50 (end of page 1) swaps across the page boundary", async () => {
    renderCard({
      members: Array.from({ length: 50 }, (_, i) => member(i + 1)),
      membersPage: 1,
      hasNextPage: true,
    });

    fireEvent.click(screen.getByRole("button", { name: label(k.moveDown, "Product 50") }));

    await waitFor(() => expect(api.reorderCollectionProducts).toHaveBeenCalledTimes(1));
    const sent = api.reorderCollectionProducts.mock.calls[0]?.[1] as string[];
    expect(sent).toHaveLength(51);
    expect(sent.slice(49)).toEqual(["p-51", "p-50"]);
  });

  it("Remove is on every row, missing rows on a later page included", async () => {
    renderCard({
      members: [
        member(50),
        { productId: "p-51", position: 50, name: null, status: null, missing: true },
      ],
    });

    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: label(k.remove, k.deleted) }));

    await waitFor(() => expect(api.removeCollectionProduct).toHaveBeenCalledTimes(1));
    expect(api.removeCollectionProduct).toHaveBeenCalledWith(
      COLLECTION,
      "p-51",
      expect.any(String),
    );
  });

  it("shows the API's refusal in an alert and still revalidates", async () => {
    api.reorderCollectionProducts.mockResolvedValue({
      outcome: "conflict",
      message: "Order changed elsewhere",
      code: "BUSINESS_RULE",
    });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: label(k.moveUp, "Product 51") }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Order changed elsewhere");
    expect(revalidatePath).toHaveBeenCalledWith(`/collections/${COLLECTION}`);
  });
});

describe("CollectionProductsCard — Browse", () => {
  it("opens the picker, lists draft and published products, and adds the picked one", async () => {
    api.fetchProductsPage.mockResolvedValue({
      outcome: "ok",
      items: [
        { id: "n-1", name: "New draft", status: "draft" },
        { id: "n-2", name: "New live", status: "published" },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: k.browse }));
    const dialog = await body().findByRole("dialog", { name: en.collections.picker.title });
    fireEvent.click(await within(dialog).findByRole("button", { name: /New draft/ }));

    await waitFor(() => expect(api.addCollectionProduct).toHaveBeenCalledTimes(1));
    expect(api.addCollectionProduct).toHaveBeenCalledWith(COLLECTION, "n-1", expect.any(String));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(revalidatePath).toHaveBeenCalledWith(`/collections/${COLLECTION}`);
  });

  it("does not let a product that is already a member be picked again", async () => {
    api.fetchProductsPage.mockResolvedValue({
      outcome: "ok",
      items: [{ id: "p-7", name: "Product 7", status: "published" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: k.browse }));
    const pick = await body().findByRole("button", { name: /Product 7/ });

    expect(pick).toBeDisabled();
    expect(pick).toHaveTextContent(en.collections.picker.alreadyAdded);
  });
});

describe("CollectionProductsCard — i18n and direction", () => {
  it("renders from ar.collections with Arabic status labels and no English fallback", () => {
    renderCard({
      t: ar,
      productIds: ["p-1", "p-2"],
      members: [member(1, { status: "draft" }), member(2)],
      membersPage: 1,
      hasNextPage: true,
    });

    expect(screen.getByText(ar.collections.products.title)).toBeVisible();
    expect(screen.getByRole("button", { name: ar.collections.products.browse })).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: ar.collections.products.moveDown.replace("{name}", "Product 1"),
      }),
    ).toBeVisible();
    expect(screen.getByText(ar.productStatus.draft)).toBeVisible();
    expect(screen.getByRole("link", { name: ar.collections.products.next })).toBeVisible();
    expect(screen.queryByText(en.collections.products.title)).toBeNull();
    expect(screen.queryByText(en.collections.products.browse)).toBeNull();
  });

  it("uses logical CSS only and flips its chevrons in RTL", () => {
    const { container } = renderCard({
      members: [member(50), member(51)],
      membersPage: 2,
      hasNextPage: true,
    });

    expect(container.innerHTML).not.toMatch(
      /(^|[\s"'])(ml|mr|pl|pr|left|right)-|text-(left|right)/,
    );
    const chevrons = container.querySelectorAll("a svg");
    expect(chevrons).toHaveLength(2);
    for (const chevron of chevrons) expect(chevron).toHaveClass("rtl:rotate-180");
  });
});
