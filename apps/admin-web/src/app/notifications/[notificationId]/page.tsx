import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, BellIcon, LockIcon, SearchXIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { NotificationLifecycleActions } from "@/components/notifications/notification-lifecycle-actions";
import { NotificationStatusBadge } from "@/components/notifications/notification-status-badge";
import { fetchNotification } from "@/lib/api/notifications";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface NotificationDetailPageProps {
  readonly params: Promise<{ readonly notificationId: string }>;
}

/**
 * The Notification Detail screen (T5.11a). Resolves the real `GET /notifications/:notificationId`
 * endpoint (`notifications:read`) and renders every `NotificationDto` field, including the
 * `attempts`/`history` tables, plus the gated lifecycle controls
 * (`NotificationLifecycleActions`). Reachable by any authenticated viewer (`middleware.ts` gates
 * only `/notifications/new` to operator+); every write action here is independently
 * permission-gated server-side, same precedent as every prior Phase 5 detail-page write action.
 */
export default async function NotificationDetailPage({ params }: NotificationDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { notificationId } = await params;

  const result = await fetchNotification(notificationId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="notifications" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.notificationDetail.unauthorized}
          backLabel={t.notificationDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="notifications" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.notificationDetail.notFound}
          backLabel={t.notificationDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="notifications" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.notificationDetail.error}
          backLabel={t.notificationDetail.back}
        />
      </AppShell>
    );
  }

  const notification = result.notification;

  return (
    <AppShell t={t} locale={locale} activeNavId="notifications" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/notifications">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.notificationDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-center gap-2 text-4xl font-semibold tracking-tight">
              <BellIcon aria-hidden="true" className="size-7" />
              {notification.recipientRef}
            </h1>
            <NotificationStatusBadge status={notification.status} t={t} />
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{notification.id}</p>
        </div>

        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t.notificationDetail.sourceRef} value={notification.sourceRef} />
            <Field label={t.notificationDetail.recipientRef} value={notification.recipientRef} />
            <Field label={t.notificationDetail.templateId} value={notification.templateId} />
            <Field
              label={t.notificationDetail.currentChannel}
              value={notification.currentChannel}
            />
            <Field
              label={t.notificationDetail.channels}
              value={notification.channels.join(", ")}
            />
            <Field
              label={t.notificationDetail.idempotencyKey}
              value={notification.idempotencyKey}
            />
            <Field
              label={t.notificationDetail.deliveredAt}
              value={
                notification.deliveredAt !== null
                  ? formatDateTime(locale, notification.deliveredAt)
                  : t.notificationDetail.notDelivered
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.notificationDetail.attemptsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {notification.attempts.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-sm sm:px-5">
                {t.notificationDetail.noAttempts}
              </p>
            ) : (
              <Table aria-label={t.notificationDetail.attemptsTitle}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.notificationDetail.attemptChannel}</TableHead>
                    <TableHead>{t.notificationDetail.attemptOutcome}</TableHead>
                    <TableHead>{t.notificationDetail.attemptProviderRef}</TableHead>
                    <TableHead>{t.notificationDetail.attemptOccurredAt}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notification.attempts.map((attempt, index) => (
                    <TableRow key={index}>
                      <TableCell className="whitespace-nowrap">{attempt.channel}</TableCell>
                      <TableCell className="whitespace-nowrap">{attempt.outcome}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {attempt.providerRef ?? t.notificationDetail.none}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(locale, attempt.occurredAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.notificationDetail.historyTitle}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {notification.history.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-sm sm:px-5">
                {t.notificationDetail.noHistory}
              </p>
            ) : (
              <Table aria-label={t.notificationDetail.historyTitle}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.notificationDetail.historyStatus}</TableHead>
                    <TableHead>{t.notificationDetail.historyOccurredAt}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notification.history.map((event, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <NotificationStatusBadge status={event.status} t={t} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(locale, event.occurredAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <NotificationLifecycleActions
          notificationId={notification.id}
          status={notification.status}
          t={t}
        />
      </div>
    </AppShell>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}

function StatePanel({
  icon,
  message,
  backLabel,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly backLabel: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-4 px-4 py-12 text-center sm:px-5">
          {icon}
          <p role="note">{message}</p>
          <Button variant="outline" asChild>
            <Link href="/notifications">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
