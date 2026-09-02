import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import type { NotificationDto } from "@/lib/api/notifications";
import type { Dictionary } from "@/messages/en";
import { NotificationStatusBadge } from "./notification-status-badge";

export function NotificationsTable({
  notifications,
  t,
}: {
  readonly notifications: readonly NotificationDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.notificationsPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.notificationsPage.columns.recipient}</TableHead>
          <TableHead>{t.notificationsPage.columns.template}</TableHead>
          <TableHead>{t.notificationsPage.columns.channel}</TableHead>
          <TableHead>{t.notificationsPage.columns.status}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {notifications.map((notification) => (
          <TableRow key={notification.id}>
            <TableCell className="font-medium whitespace-nowrap">
              <Link href={`/notifications/${notification.id}`} className="hover:text-primary">
                {notification.recipientRef}
              </Link>
            </TableCell>
            <TableCell className="font-mono text-sm">{notification.templateId}</TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {notification.currentChannel}
            </TableCell>
            <TableCell>
              <NotificationStatusBadge status={notification.status} t={t} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
