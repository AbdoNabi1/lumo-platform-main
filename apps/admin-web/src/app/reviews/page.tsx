import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon, PlusIcon, SearchXIcon, StarIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { ReviewsPagination } from "@/components/reviews/reviews-pagination";
import { ReviewsTable } from "@/components/reviews/reviews-table";
import { ReviewsToolbar } from "@/components/reviews/reviews-toolbar";
import { fetchReviewsPage, type ReviewStatus } from "@/lib/api/reviews";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

function isReviewStatus(value: string): value is ReviewStatus {
  return (
    value === "pending" ||
    value === "published" ||
    value === "rejected" ||
    value === "flagged" ||
    value === "removed"
  );
}

/**
 * Resolves the `?status=` URL param to the filter actually sent to `fetchReviewsPage` —
 * `undefined` when the operator explicitly chose "All statuses" (`status=all`,
 * `ReviewsToolbar`'s `ALL_STATUSES_VALUE`) or when it's not a recognized status, and `pending`
 * whenever the param is entirely absent (the moderation queue's own default, per the task brief).
 */
function effectiveStatus(raw: string | undefined): ReviewStatus | undefined {
  if (raw === undefined) return "pending";
  if (raw === "all") return undefined;
  return isReviewStatus(raw) ? raw : "pending";
}

interface ReviewsPageProps {
  readonly searchParams: Promise<{ readonly status?: string; readonly after?: string }>;
}

/**
 * The Review moderation queue (T5.10) — the primary screen this task delivers. No frontend
 * existed for the Reviews domain before this task. A server component: the status filter lives in
 * the URL (`?status=&after=`, driven by the client `ReviewsToolbar`/`ReviewsPagination`), so every
 * state is reachable by URL and survives a refresh/back-button — same pattern as `app/orders/
 * page.tsx`'s own status filter. Defaults to `status=pending` when the URL carries no filter at
 * all, per the brief ("the moderation queue list screen (defaulting to pending reviews)"). The
 * chrome (shell, header, toolbar) renders immediately; only the results resolve inside their own
 * `<Suspense>` boundary, so the sidebar/topbar are never blocked on `GET /reviews`. Never falls
 * back to demo data on failure.
 */
export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;
  const status = effectiveStatus(params.status);

  return (
    <AppShell t={t} locale={locale} activeNavId="reviews" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{t.reviewsPage.title}</h1>
            <p className="text-md text-muted-foreground mt-1">{t.reviewsPage.subtitle}</p>
          </div>
          <Button asChild>
            <Link href="/reviews/new">
              <PlusIcon aria-hidden="true" />
              {t.reviewsPage.newReview}
            </Link>
          </Button>
        </header>

        <ReviewsToolbar t={t} />

        <Suspense
          key={`${status ?? ""}:${params.after ?? ""}`}
          fallback={<ReviewsTableSkeleton />}
        >
          <ReviewsResults first={PAGE_SIZE} after={params.after} status={status} t={t} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function ReviewsResults({
  first,
  after,
  status,
  t,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly status: ReviewStatus | undefined;
  readonly t: Dictionary;
}) {
  const result = await fetchReviewsPage({ first, after, status });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.reviewsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.reviewsPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={
          status !== undefined ? (
            <SearchXIcon aria-hidden="true" className="size-5" />
          ) : (
            <StarIcon aria-hidden="true" className="size-5" />
          )
        }
        message={status !== undefined ? t.reviewsPage.emptyFiltered : t.reviewsPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <ReviewsTable reviews={result.items} t={t} />
      </CardContent>
      <div className="border-border flex items-center justify-end border-t px-4 py-3 sm:px-5">
        <ReviewsPagination
          hasNextPage={result.pageInfo.hasNextPage}
          endCursor={result.pageInfo.endCursor}
          t={t}
        />
      </div>
    </Card>
  );
}

function StatePanel({ icon, message }: { readonly icon: ReactNode; readonly message: string }) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
        {icon}
        <p role="note">{message}</p>
      </CardContent>
    </Card>
  );
}

function ReviewsTableSkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="p-0 sm:p-0">
        <div className="flex flex-col">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="border-border flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5"
            >
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="ms-auto h-4 w-8" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
