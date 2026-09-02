import { Badge } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * Notification status -> badge variant (`lib/notification-lifecycle.ts`'s
 * `NOTIFICATION_LIFECYCLE_TRANSITIONS`). `created`/`queued`/`sent` are in-flight, `delivered` is
 * the terminal success, `failed`/`retrying` need attention, `dead_letter` is the terminal failure,
 * `cancelled`/`expired` are terminal but not a delivery failure.
 */
const NOTIFICATION_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "info" | "success" | "warning" | "destructive" | "outline">
> = {
  created: "neutral",
  queued: "info",
  sent: "info",
  delivered: "success",
  failed: "destructive",
  retrying: "warning",
  dead_letter: "destructive",
  cancelled: "outline",
  expired: "outline",
};

export function NotificationStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = NOTIFICATION_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.notificationStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
