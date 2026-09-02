import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { FetchIdentityTimelineResult, IdentityTimelineEntryDto } from "@/lib/api/customer-360";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

function labelFor(entry: IdentityTimelineEntryDto, t: Dictionary): string {
  if (entry.kind === "observed") return t.customerDetail.identityTimelineObserved;
  if (entry.kind === "merged") return t.customerDetail.identityTimelineMerged;
  return t.customerDetail.identityTimelineSplit;
}

/**
 * The Customer 360 "Identity timeline" card (T3.3) — the Identity Engine's own provenance history
 * for this customer's `customer_id` identifier (observed links interleaved with merge/split
 * decisions), chronological, oldest first (already sorted server-side by
 * `GetIdentityTimeline.execute`). Owns its own outcome handling, independent of the page's
 * `fetchCustomer` result and of the neighboring `CustomerProfileCard`.
 */
export function CustomerIdentityTimelineCard({
  result,
  t,
  locale,
}: {
  readonly result: FetchIdentityTimelineResult;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.customerDetail.identityTimeline}</CardTitle>
      </CardHeader>
      <CardContent>
        {result.outcome === "unauthorized" ? (
          <p className="text-muted-foreground text-sm">
            {t.customerDetail.identityTimelineUnauthorized}
          </p>
        ) : result.outcome === "error" ? (
          <p className="text-muted-foreground text-sm">
            {t.customerDetail.identityTimelineUnavailable}
          </p>
        ) : result.outcome === "not_found" || result.data.entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.customerDetail.identityTimelineEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {result.data.entries.map((entry, index) => (
              <li key={index} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{labelFor(entry, t)}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {entry.counterpartType}: {entry.counterpartValue}
                  </p>
                </div>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatDateTime(locale, entry.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
