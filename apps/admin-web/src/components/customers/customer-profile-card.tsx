import { Badge, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { FetchCustomerProfileResult } from "@/lib/api/customer-360";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * The Customer 360 "Unified profile" card (T3.3) — the merged Profile Engine view for this
 * customer's `customer_id` identifier. Owns its own outcome handling, independent of the page's
 * `fetchCustomer` result: `unauthorized`/`error` render a distinct unavailable state, and a `null`
 * merged profile (no error at all — see `lib/api/customer-360.ts`'s doc comment) renders the
 * "nothing yet" empty state rather than being mistaken for a failure.
 */
export function CustomerProfileCard({
  result,
  t,
  locale,
}: {
  readonly result: FetchCustomerProfileResult;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.customerDetail.unifiedProfile}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {result.outcome === "unauthorized" ? (
          <p className="text-muted-foreground text-sm">
            {t.customerDetail.unifiedProfileUnauthorized}
          </p>
        ) : result.outcome === "error" ? (
          <p className="text-muted-foreground text-sm">
            {t.customerDetail.unifiedProfileUnavailable}
          </p>
        ) : result.outcome === "not_found" || result.data.profile === null ? (
          <p className="text-muted-foreground text-sm">{t.customerDetail.unifiedProfileEmpty}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {result.data.confidence !== null ? (
                <Badge
                  variant={result.data.confidence.overall === "verified" ? "success" : "neutral"}
                >
                  {result.data.confidence.overall === "verified"
                    ? t.customerDetail.unifiedProfileConfidenceVerified
                    : t.customerDetail.unifiedProfileConfidenceInferred}
                </Badge>
              ) : null}
              {result.data.completeness !== null ? (
                <span className="text-muted-foreground text-xs">
                  {t.customerDetail.unifiedProfileCompleteness.replace(
                    "{percent}",
                    String(Math.round(result.data.completeness * 100)),
                  )}
                </span>
              ) : null}
            </div>

            <p className="text-muted-foreground text-xs">
              {t.customerDetail.unifiedProfileUpdatedOn.replace(
                "{date}",
                formatDateTime(locale, result.data.profile.updatedAt),
              )}
            </p>

            <div>
              <p className="text-xs font-medium">{t.customerDetail.unifiedProfileMergedFrom}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {result.data.mergedFrom.map((ref) => (
                  <Badge key={`${ref.type}:${ref.value}`} variant="outline">
                    {ref.type}: {ref.value}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium">{t.customerDetail.unifiedProfileFields}</p>
              {Object.keys(result.data.profile.fields).length === 0 ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  {t.customerDetail.unifiedProfileNoFields}
                </p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {Object.entries(result.data.profile.fields).map(([field, value]) => (
                    <li key={field} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{field}</span>
                      <span className="max-w-[60%] truncate font-mono text-xs">
                        {String(value)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
