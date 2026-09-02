import Link from "next/link";
import { AlertTriangleIcon, ArrowRightIcon, MessageSquareIcon, StarIcon } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle, Separator } from "@platform/ui";
import type { CursorPageResult, ProductReviewSummary } from "@/lib/runtime-api";
import type { Dictionary } from "@/messages/en";

/**
 * The product detail page's review section (T5.18) — DISPLAY only. `page` is exactly what
 * `getProductReviews()` returned: already filtered to `status: "published"` server-side
 * (`apps/admin/src/http/public-reviews-routes.ts`), already stripped of `customerRef`/`status`/
 * `productRef`/`reportCount`, or `null` if the call failed. This component never talks to the
 * Runtime API itself — same discipline as `PriceLabel`/`AvailabilityBadge` in `product-card.tsx`,
 * which are handed an already-resolved value rather than fetching their own.
 *
 * Writing a review needs a customer-identity decision T5.16 owns, which has not landed — no
 * submission form exists here, and none should be added until a later task implements against
 * T5.16's approved design.
 *
 * `null` (fetch failed) and an empty published list are rendered as distinct, explicit states —
 * never a silently missing section — matching this codebase's "never fabricate data in the UI"
 * rule (`docs/plans/README.md`).
 */
export function ProductReviews({
  slug,
  page,
  t,
}: {
  readonly slug: string;
  readonly page: CursorPageResult<ProductReviewSummary> | null;
  readonly t: Dictionary;
}) {
  return (
    <Card>
      <CardHeader>
        <h2>
          <CardTitle as="div">{t.product.reviewsTitle}</CardTitle>
        </h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {page === null ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm" role="alert">
            <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
            {t.product.reviewsError}
          </p>
        ) : page.items.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm" role="note">
            <MessageSquareIcon aria-hidden="true" className="size-4 shrink-0" />
            {t.product.reviewsEmpty}
          </p>
        ) : (
          <>
            <ReviewsSummary items={page.items} t={t} />
            <Separator />
            <ul className="flex flex-col gap-4">
              {page.items.map((review) => (
                <li key={review.id}>
                  <ReviewItem review={review} t={t} />
                </li>
              ))}
            </ul>
          </>
        )}

        {page !== null && page.pageInfo.hasNextPage && page.pageInfo.endCursor !== null ? (
          <Link
            href={`/products/${encodeURIComponent(slug)}?reviewsAfter=${encodeURIComponent(page.pageInfo.endCursor)}`}
            className="text-muted-foreground inline-flex items-center gap-1.5 self-center text-sm"
          >
            {t.product.reviewsNextPage}
            <ArrowRightIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Average rating and count computed from the reviews actually loaded on the CURRENT page —
 * `GET /public/reviews/by-product/:productRef` is cursor-paginated with no total-count field
 * (the same limitation `t.collection.productCount` already lives with for collection member
 * products), so this deliberately does not claim to be a sitewide average; it reflects exactly
 * what is rendered below it.
 */
function ReviewsSummary({
  items,
  t,
}: {
  readonly items: readonly ProductReviewSummary[];
  readonly t: Dictionary;
}) {
  const average = items.reduce((sum, review) => sum + review.rating, 0) / items.length;
  return (
    <div className="flex items-center gap-2 text-sm">
      <StarIcon aria-hidden="true" className="fill-warning text-warning size-4 shrink-0" />
      <span className="font-medium">{average.toFixed(1)}</span>
      <span className="text-muted-foreground">
        {t.product.reviewsCount.replace("{count}", String(items.length))}
      </span>
    </div>
  );
}

function ReviewItem({
  review,
  t,
}: {
  readonly review: ProductReviewSummary;
  readonly t: Dictionary;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-sm font-medium">
          <StarIcon aria-hidden="true" className="fill-warning text-warning size-4 shrink-0" />
          {review.rating}
        </span>
        {review.verifiedPurchase && (
          <Badge variant="success">{t.product.reviewsVerifiedPurchase}</Badge>
        )}
      </div>
      <p className="text-sm">{review.bodyText}</p>
      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span>{t.product.reviewsHelpful.replace("{count}", String(review.helpfulCount))}</span>
        <span>{t.product.reviewsUnhelpful.replace("{count}", String(review.unhelpfulCount))}</span>
      </div>
      {review.merchantResponse !== null && (
        <div className="border-border bg-secondary/40 rounded-md border px-3 py-2 text-sm">
          <p className="text-muted-foreground mb-1 text-xs font-semibold">
            {t.product.reviewsMerchantResponse}
          </p>
          <p>{review.merchantResponse}</p>
        </div>
      )}
    </div>
  );
}
