import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { HomeCollection } from "@/lib/section-data";
import { CollectionCard } from "./collection-card";

const collection: HomeCollection = {
  id: "coll-1",
  name: "Featured Toys",
  slug: "featured-toys",
  productCount: 3,
  image: null,
};

beforeEach(() => {
  expect.hasAssertions();
});

describe("CollectionCard", () => {
  it("links to the collection's own page (Home → Collection navigation)", () => {
    render(<CollectionCard collection={collection} t={en} locale="en" />);
    expect(screen.getByRole("link", { name: /featured toys/i })).toHaveAttribute(
      "href",
      "/collections/featured-toys",
    );
  });

  it("shows the real member count, never a fabricated number", () => {
    render(<CollectionCard collection={collection} t={en} locale="en" />);
    expect(screen.getByText("3 products")).toBeInTheDocument();
  });

  it("omits the count line when the count is null", () => {
    render(
      <CollectionCard collection={{ ...collection, productCount: null }} t={en} locale="en" />,
    );
    expect(screen.queryByText(/products?$/)).toBeNull();
  });

  it("shows the image when it is usable, and renders without one when it is empty or unsafe", () => {
    const image = { url: "https://cdn.example/c.png", alt: "Cover", width: 1, height: 1 };
    const { container, rerender } = render(
      <CollectionCard collection={{ ...collection, image }} t={en} locale="en" />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(1);
    for (const url of ["", "javascript:alert(1)", "//evil.example/x.png"]) {
      rerender(
        <CollectionCard
          collection={{ ...collection, image: { ...image, url } }}
          t={en}
          locale="en"
        />,
      );
      expect(container.querySelectorAll("img")).toHaveLength(0);
    }
  });

  it("encodes the slug: a hostile one makes no off-site link (F5)", () => {
    render(
      <CollectionCard
        collection={{ ...collection, slug: "../..//evil.example" }}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toMatch(/^\/collections\/[^/]+$/);
  });
});
