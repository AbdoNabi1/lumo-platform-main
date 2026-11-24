import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CopyIcon,
  DatabaseIcon,
  LockIcon,
  SearchXIcon,
} from "lucide-react";
import { Badge, Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { SegmentDeleteDialog } from "@/components/customers/segments/segment-delete-dialog";
import { SegmentEditor } from "@/components/customers/segments/segment-editor";
import { SegmentMembersSearch } from "@/components/customers/segments/segment-members-search";
import { SegmentMembers } from "@/components/customers/segments/segment-members";
import { SegmentStatePanel } from "@/components/customers/segments/segment-state-panel";
import { fetchCustomerSegment, fetchSegmentStoreCurrency } from "@/lib/api/customer-segments";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import {
  decodeSegmentId,
  isSegmentsUnavailable,
  segmentDisplayName,
} from "@/lib/customers/segment-labels";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

interface SegmentPageProps {
  readonly params: Promise<{ readonly segmentId: string }>;
  readonly searchParams: Promise<{
    readonly q?: string;
    readonly after?: string;
    readonly stack?: string;
  }>;
}

/**
 * One segment: its conditions in the editor and its live members underneath. A default segment
 * and any segment a viewer opens are read-only (no Save, Add, Remove, Duplicate or Delete for a
 * viewer; a default offers Duplicate to operators). The members table is the live SQL read, so it
 * is always current; searching and paging live in `?q=&after=&stack=`.
 */
export default async function SegmentDetailPage({ params, searchParams }: SegmentPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const segmentId = decodeSegmentId((await params).segmentId);
  const query = await searchParams;
  const [user, session, segment, currency] = await Promise.all([
    getCurrentUser(),
    readSession(),
    fetchCustomerSegment(segmentId),
    fetchSegmentStoreCurrency(),
  ]);
  const role = highestRole(session?.roles ?? []);
  const canEdit = role === "operator" || role === "admin";

  if (segment.outcome !== "ok") {
    return (
      <AppShell t={t} locale={locale} activeNavId="customers-segments" user={user}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <BackLink t={t} />
          {segment.outcome === "not_found" ? (
            <SegmentStatePanel
              icon={<SearchXIcon aria-hidden="true" className="size-5" />}
              message={t.segments.notFound}
            />
          ) : segment.outcome === "unauthorized" ? (
            <SegmentStatePanel
              icon={<LockIcon aria-hidden="true" className="size-5" />}
              message={t.segments.unauthorized}
            />
          ) : isSegmentsUnavailable(segment) ? (
            <SegmentStatePanel
              icon={<DatabaseIcon aria-hidden="true" className="size-5" />}
              message={t.segments.unavailable}
            />
          ) : (
            <SegmentStatePanel
              icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
              message={t.segments.error}
            />
          )}
        </div>
      </AppShell>
    );
  }

  const view = segment.data;
  const name = segmentDisplayName(view, t);
  const isDefault = view.kind === "default";
  const readOnly = isDefault || !canEdit;

  return (
    <AppShell t={t} locale={locale} activeNavId="customers-segments" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <div>
          <BackLink t={t} />
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                <bdi dir="auto">{name}</bdi>
              </h1>
              <Badge variant={isDefault ? "neutral" : "accent"}>
                {t.segments.types[view.kind]}
              </Badge>
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/customers/segments/new?from=${encodeURIComponent(view.id)}`}>
                    <CopyIcon aria-hidden="true" />
                    {t.segments.duplicate}
                  </Link>
                </Button>
                {!isDefault && view.version !== null && (
                  <SegmentDeleteDialog
                    segmentId={view.id}
                    version={view.version}
                    name={name}
                    t={t}
                  />
                )}
              </div>
            )}
          </div>
          {isDefault ? (
            <p role="note" className="text-muted-foreground mt-2 text-sm">
              {t.segments.readOnlyNote}
            </p>
          ) : (
            !canEdit && (
              <p role="note" className="text-muted-foreground mt-2 text-sm">
                {t.segments.viewerNote}
              </p>
            )
          )}
        </div>

        {currency.outcome === "ok" ? (
          <>
            <div className="max-w-3xl">
              <SegmentEditor
                key={`${view.id}:${view.version ?? 0}`}
                t={t}
                locale={locale}
                currency={currency.data.currency}
                mode="edit"
                segmentId={view.id}
                version={view.version}
                initialName={isDefault ? name : (view.name ?? "")}
                initialConditions={view.conditions}
                readOnly={readOnly}
              />
            </div>

            <section aria-labelledby="segment-members-heading" className="flex flex-col gap-3">
              <h2 id="segment-members-heading" className="text-lg font-semibold">
                {t.segments.members.heading}
              </h2>
              <SegmentMembersSearch t={t} />
              <Suspense
                key={`${query.q ?? ""}:${query.after ?? ""}:${query.stack ?? ""}`}
                fallback={<MembersSkeleton />}
              >
                <SegmentMembers
                  segmentId={view.id}
                  search={query.q}
                  after={query.after}
                  stack={query.stack}
                  t={t}
                  locale={locale}
                />
              </Suspense>
            </section>
          </>
        ) : (
          <SegmentStatePanel
            icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
            message={t.segments.currencyError}
          />
        )}
      </div>
    </AppShell>
  );
}

function BackLink({ t }: { readonly t: Dictionary }) {
  return (
    <Button variant="ghost" size="sm" asChild className="-ms-2">
      <Link href="/customers/segments">
        <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        {t.segments.back}
      </Link>
    </Button>
  );
}

function MembersSkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="p-0 sm:p-0">
        <div className="flex flex-col">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="border-border flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5"
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="ms-auto h-4 w-40" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
