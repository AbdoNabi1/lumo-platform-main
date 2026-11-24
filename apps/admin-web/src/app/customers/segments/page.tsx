import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, DatabaseIcon, LockIcon, PlusIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { SegmentStatePanel } from "@/components/customers/segments/segment-state-panel";
import { SegmentsTable } from "@/components/customers/segments/segments-table";
import { fetchCustomerSegments } from "@/lib/api/customer-segments";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { isSegmentsUnavailable } from "@/lib/customers/segment-labels";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Shopify parity Wave 1c — Customers > Segments. The four default segments first, then the store's
 * own. Viewers read the list; "Create segment" is for operators and up (the API enforces
 * `customers:manage_segments`). A store with no database answers 503 `UNAVAILABLE`, which is its own
 * empty state; every other failure is the generic one.
 */
export default async function SegmentsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [user, session, result] = await Promise.all([
    getCurrentUser(),
    readSession(),
    fetchCustomerSegments(),
  ]);
  const role = highestRole(session?.roles ?? []);
  const canEdit = role === "operator" || role === "admin";

  return (
    <AppShell t={t} locale={locale} activeNavId="customers-segments" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t.segments.title}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t.segments.subtitle}</p>
          </div>
          {canEdit && (
            <Button asChild>
              <Link href="/customers/segments/new">
                <PlusIcon aria-hidden="true" />
                {t.segments.create}
              </Link>
            </Button>
          )}
        </header>

        {result.outcome === "ok" ? (
          <Card>
            <CardContent className="p-0 sm:p-0">
              <SegmentsTable segments={result.data.items} t={t} locale={locale} />
            </CardContent>
          </Card>
        ) : result.outcome === "unauthorized" ? (
          <SegmentStatePanel
            icon={<LockIcon aria-hidden="true" className="size-5" />}
            message={t.segments.unauthorized}
          />
        ) : result.outcome === "error" && isSegmentsUnavailable(result) ? (
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
