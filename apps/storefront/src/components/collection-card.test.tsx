import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { PublishedCollection } from "@/lib/catalog";
import { CollectionCard } from "./collection-card";

const collection: PublishedCollection = {
  id: "coll-1",
  name: "Featured Toys",
  slug: "featured-toys",
  status: "published",
  productIds: ["a", "b", "c"],
};

describe("CollectionCard", () => {
  it("links to the collection's own page (Home → Collection navigation)", () => {
    render(<CollectionCard collection={collection} t={en} locale="en" />);
    expect(screen.getByRole("link", { name: /featured toys/i })).toHaveAttribute(
      "href",
      "/collections/featured-toys",
    );
  });

  it("shows the real member count from productIds, never a fabricated number", () => {
    render(<CollectionCard collection={collection} t={en} locale="en" />);
    expect(screen.getByText("3 products")).toBeInTheDocument();
  });
});
