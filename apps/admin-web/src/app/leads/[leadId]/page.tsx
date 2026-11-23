import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { LeadStatusBadge } from "@/components/leads/lead-status-badge";
import { LeadStatusForm } from "@/components/leads/lead-status-form";
import { fetchLead } from "@/lib/api/leads";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface LeadDetailPageProps {
  readonly params: Promise<{ readonly leadId: string }>;
}

/**
 * One lead: everything the visitor sent, where they sent it from, and the status control. Visitor
 * text is isolated with `<bdi>` (names and messages `dir="auto"`, phone, email and URLs `dir="ltr"`);
 * the page URL is plain text, never a link — it is untrusted input. A viewer sees the status
 * read-only (`leads:update` belongs to operators and admins).
 */
export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { leadId } = await params;
  const session = await readSession();
  const role = highestRole(session?.roles ?? []);
  const canEdit = role === "admin" || role === "operator";

  const result = await fetchLead(leadId);

  if (result.outcome !== "ok") {
    const panel =
      result.outcome === "unauthorized"
        ? {
            icon: <LockIcon aria-hidden="true" className="size-5" />,
            message: t.leadDetail.unauthorized,
          }
        : result.outcome === "not_found"
          ? {
              icon: <SearchXIcon aria-hidden="true" className="size-5" />,
              message: t.leadDetail.notFound,
            }
          : {
              icon: <AlertTriangleIcon aria-hidden="true" className="size-5" />,
              message: t.leadDetail.error,
            };
    return (
      <AppShell t={t} locale={locale} activeNavId="leads" user={user}>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
          <h1 className="text-2xl font-semibold tracking-tight">{t.leadDetail.heading}</h1>
          <Card>
            <CardContent className="text-muted-foreground flex flex-col items-center gap-4 px-4 py-12 text-center sm:px-5">
              {panel.icon}
              <p role="note">{panel.message}</p>
              <Button variant="outline" asChild>
                <Link href="/leads">
                  <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
                  {t.leadDetail.back}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  const lead = result.lead;
  const none = t.leadDetail.notProvided;
  const trackingText =
    (t.leadTrackingStatus as Record<string, string>)[lead.trackingStatus] ?? lead.trackingStatus;

  return (
    <AppShell t={t} locale={locale} activeNavId="leads" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/leads">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.leadDetail.back}
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              <bdi dir="auto">{lead.name}</bdi>
            </h1>
            <LeadStatusBadge status={lead.status} t={t} />
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {t.leadDetail.created}: {formatDateTime(locale, lead.createdAt)}
          </p>
        </div>

        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t.leadDetail.name}>
              <bdi dir="auto">{lead.name}</bdi>
            </Field>
            <Field label={t.leadDetail.phone}>
              <bdi dir="ltr">{lead.phone}</bdi>
            </Field>
            <Field label={t.leadDetail.email}>
              {lead.email === null ? none : <bdi dir="ltr">{lead.email}</bdi>}
            </Field>
            <Field label={t.leadDetail.created}>{formatDateTime(locale, lead.createdAt)}</Field>
            <Field label={t.leadDetail.pageUrl} wide>
              {lead.pageUrl === null ? none : <bdi dir="ltr">{lead.pageUrl}</bdi>}
            </Field>
            <Field label={t.leadDetail.referrer} wide>
              {lead.referrer === null ? none : <bdi dir="ltr">{lead.referrer}</bdi>}
            </Field>
            <Field label={t.leadDetail.form}>
              <bdi dir="ltr">{lead.formId}</bdi>
            </Field>
            <Field label={t.leadDetail.message} wide>
              {lead.message === null || lead.message.length === 0 ? (
                t.leadDetail.noMessage
              ) : (
                <bdi dir="auto" className="whitespace-pre-wrap">
                  {lead.message}
                </bdi>
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.leadDetail.adPlatformsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t.leadDetail.phoneE164}>
              <bdi dir="ltr">{lead.phoneE164}</bdi>
            </Field>
            <Field label={t.leadDetail.trackingStatus}>{trackingText}</Field>
            <Field label={t.leadDetail.eventId} wide>
              <bdi dir="ltr">{lead.eventId}</bdi>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.leadDetail.statusTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <LeadStatusForm leadId={lead.id} status={lead.status} canEdit={canEdit} t={t} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  wide = false,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={wide ? "flex flex-col gap-1 sm:col-span-2" : "flex flex-col gap-1"}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="break-words text-sm">{children}</span>
    </div>
  );
}
