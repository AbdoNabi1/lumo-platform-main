import { Badge } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * Review status -> badge variant (`lib/review-lifecycle.ts`'s `REVIEW_LIFECYCLE_TRANSITIONS`).
 * `pending` = awaiting a moderator decision, `published` = live, `flagged` = live but needs
 * attention, `rejected`/`removed` = terminal and hidden from customers.
 */
const REVIEW_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "success" | "warning" | "destructive" | "outline">
> = {
  pending: "neutral",
  published: "success",
  flagged: "warning",
  rejected: "destructive",
  removed: "outline",
};

export function ReviewStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = REVIEW_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.reviewStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
