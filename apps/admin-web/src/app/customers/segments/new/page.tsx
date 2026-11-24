import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { SegmentEditor } from "@/components/customers/segments/segment-editor";
import { SegmentStatePanel } from "@/components/customers/segments/segment-state-panel";
import {
  fetchCustomerSegment,
  fetchSegmentStoreCurrency,
  type SegmentCondition,
} from "@/lib/api/customer-segments";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { decodeSegmentId, segmentDisplayName } from "@/lib/customers/segment-labels";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface NewSegmentPageProps {
  readonly searchParams: Promise<{ readonly from?: string }>;
}

/**
 * Create segment. Operators and up reach it (middleware); the API enforces
 * `customers:manage_segments`. `?from=<segmentId>` is "Duplicate": the page loads that segment on
 * the server and prefills the editor with its conditions and the name "Copy of …" — nothing about
 * the segment travels in the URL but its id. The editor's money fields are in the SHOP currency;
 * without it there is no editor (a guessed currency would turn 29 into the wrong amount).
 */
export default async function NewSegmentPage({ searchParams }: NewSegmentPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const { from } = await searchParams;
  const sourceId = from === undefined || from === "" ? null : decodeSegmentId(from);
  const [user, session] = await Promise.all([getCurrentUser(), readSession()]);
  // Page-level contract (G8): only operators and admins get the create editor, whatever the
  // middleware already did. Nothing else is loaded for anyone else.
  const role = highestRole(session?.roles ?? []);
  const canEdit = role === "operator" || role === "admin";
  const [currency, source] = canEdit
    ? await Promise.all([
        fetchSegmentStoreCurrency(),
        sourceId === null ? Promise.resolve(null) : fetchCustomerSegment(sourceId),
      ])
    : [null, null];

  let initialName = "";
  let initialConditions: readonly SegmentCondition[] = [];
  if (source !== null && source.outcome === "ok") {
    initialName = t.segments.copyOf.replace("{name}", segmentDisplayName(source.data, t));
    initialConditions = source.data.conditions;
  }

  return (
    <AppShell t={t} locale={locale} activeNavId="customers-segments" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/customers/segments">
              <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
              {t.segments.back}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{t.segments.newTitle}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t.segments.newSubtitle}</p>
        </div>
        {!canEdit || currency === null ? (
          <SegmentStatePanel
            icon={<LockIcon aria-hidden="true" className="size-5" />}
            message={t.segments.createNotAllowed}
          />
        ) : currency.outcome === "ok" ? (
          <SegmentEditor
            t={t}
            locale={locale}
            currency={currency.data.currency}
            mode="create"
            initialName={initialName}
            initialConditions={initialConditions}
            readOnly={false}
          />
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
