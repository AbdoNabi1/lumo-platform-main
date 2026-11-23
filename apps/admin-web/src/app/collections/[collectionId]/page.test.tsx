import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  fetchCollection: vi.fn(),
  fetchCollectionMembers: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/api/collections", () => ({
  fetchCollection: mocks.fetchCollection,
  fetchCollectionMembers: mocks.fetchCollectionMembers,
  createCollection: vi.fn(),
  renameCollection: vi.fn(),
  addCollectionProduct: vi.fn(),
  removeCollectionProduct: vi.fn(),
  reorderCollectionProducts: vi.fn(),
  publishCollection: vi.fn(),
  unpublishCollection: vi.fn(),
  deleteCollection: vi.fn(),
}));
vi.mock("@/lib/api/products", () => ({ fetchProductsPage: vi.fn() }));

const { default: CollectionPage } = await import("./page");

const IDS = Array.from({ length: 51 }, (_, i) => `p-${i + 1}`);
const collection = {
  id: "c-1",
  name: "Summer",
  slug: "summer",
  status: "draft" as const,
  productIds: IDS,
  productCount: 51,
};

async function renderPage(membersPage?: string | string[]) {
  render(
    await CollectionPage({
      params: Promise.resolve({ collectionId: "c-1" }),
      searchParams: Promise.resolve(membersPage === undefined ? {} : { membersPage }),
    }),
  );
}

beforeEach(() => {
  expect.hasAssertions();
  mocks.fetchCollection.mockReset().mockResolvedValue({ outcome: "ok", collection });
  mocks.fetchCollectionMembers.mockReset().mockResolvedValue({
    outcome: "ok",
    items: [
      { productId: "p-51", position: 50, name: "Member 51", status: "draft", missing: false },
    ],
    pageInfo: { hasNextPage: false, endCursor: "50" },
  });
  mocks.notFound.mockClear();
});

describe("collection detail page", () => {
  it("page 1 asks for the first 50 members, with no cursor", async () => {
    await renderPage();

    expect(mocks.fetchCollectionMembers).toHaveBeenCalledWith("c-1", { first: 50 });
  });

  it("?membersPage=2 asks for 50 members after index 49 and shows member 51 with a link back", async () => {
    await renderPage("2");

    expect(mocks.fetchCollectionMembers).toHaveBeenCalledWith("c-1", { first: 50, after: "49" });
    expect(screen.getByText("Member 51")).toBeVisible();
    expect(
      screen.getByRole("link", { name: new RegExp(en.collections.products.previous) }),
    ).toHaveAttribute("href", "/collections/c-1?membersPage=1");
  });

  it.each([["0"], ["-3"], ["abc"], ["2.5"], [["2", "3"]]])(
    "membersPage %j falls back to page 1",
    async (value) => {
      await renderPage(value);

      expect(mocks.fetchCollectionMembers).toHaveBeenCalledWith("c-1", { first: 50 });
    },
  );

  it("renders the collection's title in <bdi dir=auto> with its status, and the delete trigger", async () => {
    await renderPage();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.querySelector("bdi")).toHaveTextContent("Summer");
    expect(heading.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(screen.getAllByText(en.collections.statusDraft).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: en.collections.delete.trigger })).toBeVisible();
  });

  it("calls notFound() on a 404 for the collection", async () => {
    mocks.fetchCollection.mockResolvedValue({ outcome: "not_found" });

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it("shows a sign-in note, or an error note, instead of the editor", async () => {
    mocks.fetchCollection.mockResolvedValue({ outcome: "unauthorized" });
    await renderPage();
    expect(screen.getByRole("note")).toHaveTextContent(en.collections.unauthorized);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("keeps the editor and says the products could not load when only the members request failed", async () => {
    mocks.fetchCollectionMembers.mockResolvedValue({ outcome: "error", message: "boom" });

    await renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(en.collections.products.loadError);
    expect(screen.getByRole("button", { name: en.collections.products.browse })).toBeVisible();
  });
});
