import { Badge } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

const THEME_STATUS_VARIANT: Readonly<Record<string, "neutral" | "success" | "outline">> = {
  draft: "neutral",
  active: "success",
  archived: "outline",
};

export function ThemeStatusBadge({ status, t }: { readonly status: string; readonly t: Dictionary }) {
  const variant = THEME_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.themeStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
