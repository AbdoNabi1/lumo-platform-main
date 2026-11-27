import { Badge } from "@platform/ui";
import type { DiscountStatus } from "@/lib/discounts/model";
import type { Dictionary } from "@/messages/en";

const VARIANT: Readonly<Record<DiscountStatus, "success" | "info" | "outline">> = {
  active: "success",
  scheduled: "info",
  expired: "outline",
};

/** Shopify's discount status: Active, Scheduled or Expired (a deactivated discount reads Expired). */
export function DiscountStatusBadge({
  status,
  t,
}: {
  readonly status: DiscountStatus;
  readonly t: Dictionary;
}) {
  return <Badge variant={VARIANT[status]}>{t.discounts.status[status]}</Badge>;
}
