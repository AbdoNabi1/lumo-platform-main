import { Badge } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

const PAGE_STATUS_VARIANT: Readonly<Record<string, "neutral" | "success" | "outline">> = {
  draft: "neutral",
  published: "success",
  archived: "outline",
};

export function PageStatusBadge({ status, t }: { readonly status: string; readonly t: Dictionary }) {
  const variant = PAGE_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.pageStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
