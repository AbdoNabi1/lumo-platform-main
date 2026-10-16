"use client";

import { useId } from "react";
import { Card, CardContent } from "@platform/ui";
import type { DiscountDto, DiscountInput } from "@/lib/discounts/model";
import { discountSummary, pluralCount } from "@/lib/discounts/summary";
import type { DiscountFormValues } from "@/lib/discounts/form";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { DiscountStatusBadge } from "../discount-status-badge";

/** Shopify's Summary card: the code or title, the type and method, then the details as bullets. */
export function SummaryCard({
  values,
  input,
  status,
  t,
  locale,
  currency,
  timeZone,
}: {
  readonly values: DiscountFormValues;
  readonly input: DiscountInput;
  readonly status: DiscountDto["status"] | null;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly currency: string;
  readonly timeZone: string;
}) {
  const headingId = useId();
  const copy = t.discounts.summary;
  const name =
    values.method === "code"
      ? values.code.trim().toUpperCase() || copy.noCode
      : values.title.trim() || copy.noTitle;
  const lines = discountSummary(input, { t: copy, locale, currency, timeZone });
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardContent className="flex flex-col gap-3 py-5">
        <h2 id={headingId} className="text-sm font-semibold">
          {copy.title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{name}</span>
          {status !== null && <DiscountStatusBadge status={status} t={t} />}
        </div>
        <div className="text-muted-foreground text-sm">
          <p>{t.discounts.types[values.type]}</p>
          <p>
            {values.method === "code"
              ? t.discounts.form.methodCode
              : t.discounts.form.methodAutomatic}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{copy.details}</h3>
          <ul className="list-disc ps-5 text-sm">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

/** On a saved discount: how often it has been used. */
export function PerformanceCard({
  usageCount,
  t,
  locale,
}: {
  readonly usageCount: number;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-5">
        <h2 className="text-sm font-semibold">{t.discounts.summary.performance}</h2>
        <p className="text-sm">{pluralCount(t.discounts.summary.usedTimes, usageCount, locale)}</p>
      </CardContent>
    </Card>
  );
}
