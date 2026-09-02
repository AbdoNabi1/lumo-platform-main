import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon, StarIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { ReviewCustomerActions } from "@/components/reviews/review-customer-actions";
import { ReviewLifecycleActions } from "@/components/reviews/review-lifecycle-actions";
import { ReviewRespondForm } from "@/components/reviews/review-respond-form";
import { ReviewStatusBadge } from "@/components/reviews/review-status-badge";
import { fetchReview } from "@/lib/api/reviews";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface ReviewDetailPageProps {
  readonly params: Promise<{ readonly reviewId: string }>;
}

/**
 * The Review Detail screen (T5.10). Resolves the real `GET /reviews/:reviewId` endpoint
 * (`reviews:read`) and renders every `ReviewDto` field plus the gated moderation controls
 * (`ReviewLifecycleActions`), the merchant-response form (`ReviewRespondForm`), and the
 * vote/report forms (`ReviewCustomerActions`, offered mostly for completeness/testing — see their
 * own doc comments). Reachable by any authenticated viewer (`middleware.ts` gates only `/reviews/
 * new` to operator+); every write action here is independently permission-gated server-side, same
 * precedent as every prior Phase 5 detail-page write action.
 */
export default async function ReviewDetailPage({ params }: ReviewDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { reviewId } = await params;

  const result = await fetchReview(reviewId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="reviews" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.reviewDetail.unauthorized}
          backLabel={t.reviewDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="reviews" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.reviewDetail.notFound}
          backLabel={t.reviewDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="reviews" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.reviewDetail.error}
          backLabel={t.reviewDetail.back}
        />
      </AppShell>
    );
  }

  const review = result.review;

  return (
    <AppShell t={t} locale={locale} activeNavId="reviews" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/reviews">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.reviewDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-center gap-1 text-4xl font-semibold tracking-tight">
              <StarIcon aria-hidden="true" className="size-7 fill-current" />
              {review.rating}
            </h1>
            <ReviewStatusBadge status={review.status} t={t} />
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{review.productRef}</p>
        </div>

        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t.reviewDetail.product} value={review.productRef} />
            <Field label={t.reviewDetail.customer} value={review.customerRef} />
            <Field
              label={t.reviewDetail.verifiedPurchase}
              value={review.verifiedPurchase ? t.reviewDetail.yes : t.reviewDetail.no}
            />
            <Field label={t.reviewDetail.reportCount} value={String(review.reportCount)} />
            <Field label={t.reviewDetail.helpfulCount} value={String(review.helpfulCount)} />
            <Field label={t.reviewDetail.unhelpfulCount} value={String(review.unhelpfulCount)} />
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-muted-foreground text-xs">{t.reviewDetail.body}</span>
              <p className="text-sm whitespace-pre-wrap">{review.bodyText}</p>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-muted-foreground text-xs">{t.reviewDetail.assets}</span>
              {review.assetRefs.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {review.assetRefs.map((ref) => (
                    <li key={ref} className="font-mono text-sm">
                      {ref}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-sm">{t.reviewDetail.noAssets}</span>
              )}
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-muted-foreground text-xs">{t.reviewDetail.merchantResponse}</span>
              <p className="text-sm">
                {review.merchantResponse ?? t.reviewDetail.noMerchantResponse}
              </p>
            </div>
          </CardContent>
        </Card>

        <ReviewLifecycleActions reviewId={review.id} status={review.status} t={t} />
        <ReviewRespondForm
          reviewId={review.id}
          merchantResponse={review.merchantResponse}
          t={t}
        />
        <ReviewCustomerActions reviewId={review.id} t={t} />
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
            <Link href="/reviews">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
