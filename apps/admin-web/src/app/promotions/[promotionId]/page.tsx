import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { PromotionEvaluatePanel } from "@/components/promotions/promotion-evaluate-panel";
import { PromotionLifecycleActions } from "@/components/promotions/promotion-lifecycle-actions";
import { PromotionStatusBadge } from "@/components/promotions/promotion-status-badge";
import { fetchPromotion } from "@/lib/api/promotions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface PromotionDetailPageProps {
  readonly params: Promise<{ readonly promotionId: string }>;
}

/**
 * The Promotion Detail screen (T5.8 Part B). Resolves the real `GET /promotions/:promotionId`
 * endpoint (already fully DTO-mapped since Phase 4 T4.5) and renders the full field set, the
 * "advance to…"/"record usage" lifecycle controls (`PromotionLifecycleActions`, gated by
 * `lib/promotion-lifecycle.ts`), and the "Evaluate" simulation panel (`PromotionEvaluatePanel`).
 */
export default async function PromotionDetailPage({ params }: PromotionDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { promotionId } = await params;

  const result = await fetchPromotion(promotionId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="promotions" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.promotionDetail.unauthorized}
          backLabel={t.promotionDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="promotions" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.promotionDetail.notFound}
          backLabel={t.promotionDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="promotions" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.promotionDetail.error}
          backLabel={t.promotionDetail.back}
        />
      </AppShell>
    );
  }

  const promotion = result.promotion;
  const refList = (refs: readonly string[] | null) =>
    refs === null || refs.length === 0 ? t.promotionDetail.none : refs.join(", ");

  return (
    <AppShell t={t} locale={locale} activeNavId="promotions" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/promotions">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.promotionDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tight">{promotion.name}</h1>
            <PromotionStatusBadge status={promotion.status} t={t} />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
          <div className="flex flex-col gap-6 xl:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>{t.promotionDetail.fieldsTitle}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label={t.promotionDetail.ruleType} value={(t.promotionRuleType as Record<string, string>)[promotion.ruleType] ?? promotion.ruleType} />
                <Field label={t.promotionDetail.scope} value={(t.promotionScope as Record<string, string>)[promotion.scope] ?? promotion.scope} />
                <Field label={t.promotionDetail.targetRefs} value={refList(promotion.targetRefs)} />
                <Field
                  label={t.promotionDetail.minimumQuantity}
                  value={promotion.minimumQuantity !== null ? String(promotion.minimumQuantity) : t.promotionDetail.none}
                />
                <Field
                  label={t.promotionDetail.minimumSubtotalAmountMinor}
                  value={
                    promotion.minimumSubtotalAmountMinor !== null
                      ? String(promotion.minimumSubtotalAmountMinor)
                      : t.promotionDetail.none
                  }
                />
                <Field label={t.promotionDetail.rewardType} value={(t.promotionRewardType as Record<string, string>)[promotion.rewardType] ?? promotion.rewardType} />
                <Field
                  label={t.promotionDetail.rewardValue}
                  value={promotion.rewardValue !== null ? String(promotion.rewardValue) : t.promotionDetail.none}
                />
                <Field
                  label={t.promotionDetail.buyQuantity}
                  value={promotion.buyQuantity !== null ? String(promotion.buyQuantity) : t.promotionDetail.none}
                />
                <Field
                  label={t.promotionDetail.getQuantity}
                  value={promotion.getQuantity !== null ? String(promotion.getQuantity) : t.promotionDetail.none}
                />
                <Field
                  label={t.promotionDetail.stackable}
                  value={promotion.stackable ? t.promotionDetail.yes : t.promotionDetail.no}
                />
                <Field label={t.promotionDetail.priority} value={String(promotion.priority)} />
                <Field label={t.promotionDetail.startsAt} value={formatDateTime(locale, promotion.startsAt)} />
                <Field
                  label={t.promotionDetail.endsAt}
                  value={promotion.endsAt !== null ? formatDateTime(locale, promotion.endsAt) : t.promotionDetail.none}
                />
                <Field label={t.promotionDetail.customerRefs} value={refList(promotion.customerRefs)} />
                <Field label={t.promotionDetail.segmentRefs} value={refList(promotion.segmentRefs)} />
                <Field label={t.promotionDetail.campaignRef} value={promotion.campaignRef ?? t.promotionDetail.none} />
                <Field
                  label={t.promotionDetail.usage}
                  value={
                    promotion.usageLimit !== null
                      ? `${promotion.usageCount} / ${promotion.usageLimit}`
                      : `${promotion.usageCount} (${t.promotionsPage.unlimited})`
                  }
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t.promotionEvaluate.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <PromotionEvaluatePanel t={t} />
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card>
              <CardContent>
                <PromotionLifecycleActions promotionId={promotion.id} status={promotion.status} t={t} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value}</span>
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
            <Link href="/promotions">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
