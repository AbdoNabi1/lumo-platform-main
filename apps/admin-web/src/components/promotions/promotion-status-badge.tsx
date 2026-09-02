import { Badge } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

const PROMOTION_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "info" | "success" | "warning" | "destructive" | "outline">
> = {
  draft: "neutral",
  scheduled: "info",
  active: "success",
  paused: "warning",
  expired: "outline",
  depleted: "outline",
  cancelled: "destructive",
  archived: "outline",
};

export function PromotionStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = PROMOTION_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.promotionStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
