import { Badge } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * Lead status -> badge variant. The status is always written out in the badge, so its meaning never
 * rests on colour alone. `new` waits for the merchant, `contacted` needs a follow-up, `qualified`
 * and `converted` are the wins, `rejected` is closed, `spam` is junk.
 */
const LEAD_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "success" | "warning" | "destructive" | "outline">
> = {
  new: "neutral",
  contacted: "warning",
  qualified: "success",
  converted: "success",
  rejected: "outline",
  spam: "destructive",
};

export function LeadStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = LEAD_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.leadStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
