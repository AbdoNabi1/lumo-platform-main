import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { CursorPageResult, ProductReviewSummary } from "@/lib/runtime-api";
import { ProductReviews } from "./product-reviews";

/**
 * T5.18 — the product detail page's review section, DISPLAY only. `page` is exactly what
 * `getProductReviews()` returns; this component itself never fetches, so every scenario is
 * exercised by handing it a `page` value directly.
 */

function reviewFixture(overrides: Partial<ProductReviewSummary> = {}): ProductReviewSummary {
  return {
    id: "review-1",
    rating: 5,
    bodyText: "Absolutely love it.",
    assetRefs: [],
    verifiedPurchase: true,
    helpfulCount: 3,
    unhelpfulCount: 1,
    merchantResponse: null,
    ...overrides,
  };
}

function pageOf(
  items: readonly ProductReviewSummary[],
  hasNextPage = false,
  endCursor: string | null = null,
): CursorPageResult<ProductReviewSummary> {
  return { items, pageInfo: { hasNextPage, endCursor } };
}

describe("ProductReviews", () => {
  it("renders an explicit error state when the fetch failed, never a silently missing section", () => {
    render(<ProductReviews slug="wooden-blocks" page={null} t={en} />);
    expect(screen.getByRole("alert")).toHaveTextContent(en.product.reviewsError);
    expect(screen.queryByText(en.product.reviewsEmpty)).not.toBeInTheDocument();
  });

  it("renders an explicit empty state for a product with no published reviews yet", () => {
    render(<ProductReviews slug="wooden-blocks" page={pageOf([])} t={en} />);
    expect(screen.getByRole("note")).toHaveTextContent(en.product.reviewsEmpty);
  });

  it("renders the average rating and count computed from the loaded page", () => {
    render(
      <ProductReviews
        slug="wooden-blocks"
        page={pageOf([reviewFixture({ rating: 5 }), reviewFixture({ id: "review-2", rating: 3 })])}
        t={en}
      />,
    );
    expect(screen.getByText("4.0")).toBeInTheDocument();
    expect(screen.getByText(en.product.reviewsCount.replace("{count}", "2"))).toBeInTheDocument();
  });

  it("shows a verified-purchase badge only when the review carries it", () => {
    render(
      <ProductReviews
        slug="wooden-blocks"
        page={pageOf([
          reviewFixture({ id: "verified", verifiedPurchase: true }),
          reviewFixture({ id: "unverified", verifiedPurchase: false }),
        ])}
        t={en}
      />,
    );
    expect(screen.getAllByText(en.product.reviewsVerifiedPurchase)).toHaveLength(1);
  });

  it("renders the merchant response only when one is present", () => {
    const { rerender } = render(
      <ProductReviews
        slug="wooden-blocks"
        page={pageOf([reviewFixture({ merchantResponse: null })])}
        t={en}
      />,
    );
    expect(screen.queryByText(en.product.reviewsMerchantResponse)).not.toBeInTheDocument();

    rerender(
      <ProductReviews
        slug="wooden-blocks"
        page={pageOf([reviewFixture({ merchantResponse: "Thanks for the kind words!" })])}
        t={en}
      />,
    );
    expect(screen.getByText(en.product.reviewsMerchantResponse)).toBeInTheDocument();
    expect(screen.getByText("Thanks for the kind words!")).toBeInTheDocument();
  });

  it("shows a next-page link that carries the cursor, only when more reviews exist", () => {
    const { rerender } = render(
      <ProductReviews slug="wooden-blocks" page={pageOf([reviewFixture()], false, null)} t={en} />,
    );
    expect(screen.queryByRole("link", { name: en.product.reviewsNextPage })).not.toBeInTheDocument();

    rerender(
      <ProductReviews
        slug="wooden-blocks"
        page={pageOf([reviewFixture()], true, "cursor-2")}
        t={en}
      />,
    );
    expect(screen.getByRole("link", { name: en.product.reviewsNextPage })).toHaveAttribute(
      "href",
      "/products/wooden-blocks?reviewsAfter=cursor-2",
    );
  });

  it("renders each review's body text, and the helpful/unhelpful counts", () => {
    render(
      <ProductReviews
        slug="wooden-blocks"
        page={pageOf([reviewFixture({ bodyText: "Kept my kid busy for hours." })])}
        t={en}
      />,
    );
    expect(screen.getByText("Kept my kid busy for hours.")).toBeInTheDocument();
    expect(screen.getByText(en.product.reviewsHelpful.replace("{count}", "3"))).toBeInTheDocument();
    expect(
      screen.getByText(en.product.reviewsUnhelpful.replace("{count}", "1")),
    ).toBeInTheDocument();
  });
});
