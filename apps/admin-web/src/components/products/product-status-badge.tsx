import { Badge } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

const PRODUCT_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "accent" | "success" | "warning" | "outline">
> = {
  draft: "neutral",
  scheduled: "warning",
  published: "success",
  archived: "outline",
};

export function ProductStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = PRODUCT_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.productStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
