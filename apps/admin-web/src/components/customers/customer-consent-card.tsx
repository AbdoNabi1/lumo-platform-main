import type { ReactNode } from "react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { CustomerConsentDto } from "@/lib/api/customers";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * Consent is an append-only log (`services/identity/src/domain/consent-record.ts`) — current
 * state per scope is the LATEST record, so this collapses to one row per scope before rendering
 * rather than listing every historical grant/revoke.
 */
function latestPerScope(consents: readonly CustomerConsentDto[]): readonly CustomerConsentDto[] {
  const latest = new Map<string, CustomerConsentDto>();
  for (const consent of consents) {
    const existing = latest.get(consent.scope);
    if (existing === undefined || consent.occurredAt >= existing.occurredAt) {
      latest.set(consent.scope, consent);
    }
  }
  return [...latest.values()];
}

/** The two scopes staff manage get their Shopify names; any other scope shows its raw name. */
function scopeLabel(scope: string, t: Dictionary): ReactNode {
  if (scope === "marketing") return t.customerDetail.consentScopes.marketing;
  if (scope === "marketing_sms") return t.customerDetail.consentScopes.marketingSms;
  return <bdi>{scope}</bdi>;
}

export function CustomerConsentCard({
  consents,
  t,
  locale,
}: {
  readonly consents: readonly CustomerConsentDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const current = latestPerScope(consents);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.customerDetail.consent}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {current.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.customerDetail.noConsent}</p>
        ) : (
          current.map((consent) => (
            <div key={consent.scope} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{scopeLabel(consent.scope, t)}</p>
                <p className="text-muted-foreground text-xs">
                  {t.customerDetail.consentUpdatedOn.replace(
                    "{date}",
                    formatDateTime(locale, consent.occurredAt),
                  )}
                </p>
              </div>
              <Badge variant={consent.granted ? "success" : "neutral"}>
                {consent.granted ? t.customerDetail.consentGranted : t.customerDetail.consentDenied}
              </Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
