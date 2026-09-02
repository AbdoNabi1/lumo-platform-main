import Link from "next/link";
import { StarIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import type { ReviewDto } from "@/lib/api/reviews";
import type { Dictionary } from "@/messages/en";
import { ReviewStatusBadge } from "./review-status-badge";

const EXCERPT_MAX_LENGTH = 100;

/** A single-line excerpt of the review body — the full text is on the detail page. */
function excerptOf(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (trimmed.length <= EXCERPT_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, EXCERPT_MAX_LENGTH).trimEnd()}…`;
}

export function ReviewsTable({
  reviews,
  t,
}: {
  readonly reviews: readonly ReviewDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.reviewsPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.reviewsPage.columns.rating}</TableHead>
          <TableHead>{t.reviewsPage.columns.review}</TableHead>
          <TableHead>{t.reviewsPage.columns.verified}</TableHead>
          <TableHead className="text-end">{t.reviewsPage.columns.reports}</TableHead>
          <TableHead>{t.reviewsPage.columns.status}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reviews.map((review) => (
          <TableRow key={review.id}>
            <TableCell className="font-medium whitespace-nowrap">
              <Link
                href={`/reviews/${review.id}`}
                className="hover:text-primary flex items-center gap-1"
                aria-label={t.reviewsPage.viewReview.replace("{productRef}", review.productRef)}
              >
                <StarIcon aria-hidden="true" className="size-4 fill-current" />
                {review.rating}
              </Link>
            </TableCell>
            <TableCell className="max-w-md">
              <Link href={`/reviews/${review.id}`} className="hover:text-primary">
                {excerptOf(review.bodyText)}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {review.verifiedPurchase ? t.reviewsPage.verifiedYes : t.reviewsPage.verifiedNo}
            </TableCell>
            <TableCell className="text-end tabular-nums">{review.reportCount}</TableCell>
            <TableCell>
              <ReviewStatusBadge status={review.status} t={t} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
