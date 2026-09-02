import { Badge } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

const TEMPLATE_STATUS_VARIANT: Readonly<Record<string, "success" | "outline">> = {
  active: "success",
  archived: "outline",
};

export function TemplateStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = TEMPLATE_STATUS_VARIANT[status] ?? "outline";
  const label = (t.templateStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
