import { Badge } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

const COMPONENT_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "success" | "warning" | "outline">
> = {
  draft: "neutral",
  published: "success",
  deprecated: "warning",
  archived: "outline",
};

export function ComponentStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = COMPONENT_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.componentStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
