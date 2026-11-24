import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CollectionDto } from "@/lib/api/collections";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { CollectionsTable } from "./collections-table";

const draft: CollectionDto = {
  id: "0b6d2c44-7a3e-4f0a-9d1e-1f2a3b4c5d6e",
  name: "Summer",
  slug: "summer",
  status: "draft",
  productIds: [],
  productCount: 0,
};
const live: CollectionDto = {
  id: "c 2/x",
  name: "مجموعة الشتاء",
  slug: "winter",
  status: "published",
  productIds: ["a", "b", "c"],
  productCount: 3,
};

beforeEach(() => {
  expect.hasAssertions();
});

describe("CollectionsTable", () => {
  it("shows a draft collection as a title link, a count of 0 and the Draft badge", () => {
    render(<CollectionsTable collections={[draft]} t={en} locale="en" />);

    const row = screen.getAllByRole("row")[1] as HTMLElement;
    const link = within(row).getByRole("link", { name: "Summer" });
    expect(link).toHaveAttribute("href", `/collections/${draft.id}`);
    const cells = within(row).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("0");
    expect(cells[2]).toHaveTextContent(en.collections.statusDraft);
  });

  it("shows Active for a published collection, encodes the id and isolates the title", () => {
    render(<CollectionsTable collections={[live]} t={en} locale="en" />);

    const row = screen.getAllByRole("row")[1] as HTMLElement;
    const link = within(row).getByRole("link");
    expect(link).toHaveAttribute("href", "/collections/c%202%2Fx");
    expect(link.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(within(row).getAllByRole("cell")[1]).toHaveTextContent("3");
    expect(within(row).getAllByRole("cell")[2]).toHaveTextContent(en.collections.statusPublished);
  });

  it("has Shopify's columns: Title, Products, Status", () => {
    render(<CollectionsTable collections={[draft]} t={en} locale="en" />);

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      en.collections.columns.title,
      en.collections.columns.products,
      en.collections.columns.status,
    ]);
  });

  it("renders every label from ar.collections, with no English fallback", () => {
    render(<CollectionsTable collections={[draft, live]} t={ar} locale="ar" />);

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      ar.collections.columns.title,
      ar.collections.columns.products,
      ar.collections.columns.status,
    ]);
    expect(screen.getByRole("table", { name: ar.collections.title })).toBeVisible();
    expect(screen.getByText(ar.collections.statusDraft)).toBeVisible();
    expect(screen.getByText(ar.collections.statusPublished)).toBeVisible();
    for (const english of [
      en.collections.columns.title,
      en.collections.columns.products,
      en.collections.columns.status,
      en.collections.statusDraft,
      en.collections.statusPublished,
    ]) {
      expect(screen.queryByText(english)).toBeNull();
    }
  });

  it("uses logical CSS only", () => {
    const { container } = render(<CollectionsTable collections={[draft]} t={en} locale="en" />);
    expect(container.innerHTML).not.toMatch(
      /(^|[\s"'])(ml|mr|pl|pr|left|right)-|text-(left|right)/,
    );
  });
});
