import { AlertTriangleIcon, DatabaseIcon, LockIcon, SearchXIcon, UsersIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { CustomersPagination } from "@/components/customers/customers-pagination";
import { fetchSegmentMembers } from "@/lib/api/customer-segments";
import { customerCountLabel, isSegmentsUnavailable } from "@/lib/customers/segment-labels";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { SegmentMembersTable } from "./segment-members-table";
import { SegmentStatePanel } from "./segment-state-panel";

export const SEGMENT_MEMBERS_PAGE_SIZE = 20;

/** The members of the segment, one cursor page: the live total, the table and Previous / Next. */
export async function SegmentMembers({
  segmentId,
  search,
  after,
  stack,
  t,
  locale,
}: {
  readonly segmentId: string;
  readonly search: string | undefined;
  readonly after: string | undefined;
  readonly stack: string | undefined;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const k = t.segments.members;
  const result = await fetchSegmentMembers(segmentId, {
    first: SEGMENT_MEMBERS_PAGE_SIZE,
    ...(after === undefined || after === "" ? {} : { after }),
    ...(search === undefined || search === "" ? {} : { search }),
  });

  if (result.outcome === "unauthorized") {
    return (
      <SegmentStatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.segments.unauthorized}
      />
    );
  }
  if (result.outcome === "not_found") {
    return (
      <SegmentStatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={t.segments.notFound}
      />
    );
  }
  if (result.outcome === "error") {
    return isSegmentsUnavailable(result) ? (
      <SegmentStatePanel
        icon={<DatabaseIcon aria-hidden="true" className="size-5" />}
        message={t.segments.unavailable}
      />
    ) : (
      <SegmentStatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={k.error}
      />
    );
  }

  const page = result.data;
  const hasCursor = Boolean(after) || Boolean(stack);
  const hasSearch = Boolean(search);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm" role="status">
        {customerCountLabel(page.total, locale, t)}
      </p>
      {page.items.length === 0 ? (
        <>
          <SegmentStatePanel
            icon={
              hasSearch ? (
                <SearchXIcon aria-hidden="true" className="size-5" />
              ) : (
                <UsersIcon aria-hidden="true" className="size-5" />
              )
            }
            message={hasSearch ? k.emptyFiltered : k.empty}
          />
          {hasCursor && (
            <div className="flex items-center justify-end">
              <CustomersPagination hasNextPage={false} endCursor={null} t={t} />
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <SegmentMembersTable
              members={page.items}
              currency={page.currency}
              t={t}
              locale={locale}
            />
          </CardContent>
          <div className="border-border flex items-center justify-between border-t px-4 py-3 sm:px-5">
            <CustomersPagination
              hasNextPage={page.pageInfo.hasNextPage}
              endCursor={page.pageInfo.endCursor}
              t={t}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
