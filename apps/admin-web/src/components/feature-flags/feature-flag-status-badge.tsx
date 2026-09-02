import { Badge } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * Flag status -> badge variant (`lib/feature-flag-lifecycle.ts`'s `FLAG_LIFECYCLE_TRANSITIONS`).
 * `active` is the live, healthy state, `killed` needs attention (disabled but recoverable), and
 * `archived` is the terminal, retired state.
 */
const FLAG_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "info" | "success" | "warning" | "destructive" | "outline">
> = {
  active: "success",
  killed: "warning",
  archived: "outline",
};

export function FeatureFlagStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = FLAG_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.featureFlagStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
