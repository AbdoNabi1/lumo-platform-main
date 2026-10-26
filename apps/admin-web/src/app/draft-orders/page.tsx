import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  AlertTriangleIcon,
  FileTextIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  SearchXIcon,
} from "lucide-react";
import { Button, Card, CardContent, Input, Label } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { DraftOrdersTable } from "@/components/draft-orders/draft-orders-table";
import { DraftOrdersTabs } from "@/components/draft-orders/draft-orders-tabs";
import { OrdersPagination } from "@/components/orders/orders-pagination";
import { fetchDraftOrders } from "@/lib/api/draft-orders";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { canEditDrafts, DRAFT_PAGE_SIZE, parseDraftStatus } from "@/lib/orders/draft-orders";

interface DraftOrdersPageProps {
  readonly searchParams: Promise<{
    readonly status?: string;
    readonly q?: string;
    readonly after?: string;
  }>;
}

/** Orders → Drafts (order operations Part 4, Shopify's screen). */
export default async function DraftOrdersPage({ searchParams }: DraftOrdersPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const d = t.draftOrders;
  const user = await getCurrentUser();
  const canEdit = canEditDrafts(highestRole((await readSession())?.roles ?? []));
  const params = await searchParams;
  const q = params.q?.trim() || undefined;
  const status = parseDraftStatus(params.status);
  const result = await fetchDraftOrders({ first: DRAFT_PAGE_SIZE, after: params.after, q, status });

  let content: ReactNode;
  if (result.outcome === "unauthorized") {
    content = (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={d.unauthorized}
      />
    );
  } else if (result.outcome !== "ok") {
    content = (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={d.error}
      />
    );
  } else if (result.data.items.length === 0) {
    content =
      q !== undefined || status !== undefined ? (
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={d.emptyFiltered}
        />
      ) : (
        <StatePanel
          icon={<FileTextIcon aria-hidden="true" className="size-5" />}
          message={d.empty}
          detail={d.emptyBody}
        />
      );
  } else {
    content = (
      <Card>
        <CardContent className="p-0 sm:p-0">
          <DraftOrdersTable drafts={result.data.items} t={t} locale={locale} />
        </CardContent>
        <div className="border-border flex items-center justify-between border-t px-4 py-3 sm:px-5">
          <OrdersPagination
            hasNextPage={result.data.pageInfo.hasNextPage}
            endCursor={result.data.pageInfo.endCursor}
            t={t}
          />
        </div>
      </Card>
    );
  }

  return (
    <AppShell t={t} locale={locale} activeNavId="draft-orders" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{d.title}</h1>
          {canEdit && (
            <Button asChild>
              <Link href="/draft-orders/new">
                <PlusIcon aria-hidden="true" />
                {d.createOrder}
              </Link>
            </Button>
          )}
        </header>
        <DraftOrdersTabs current={status} q={q} t={t} />
        <form
          role="search"
          method="get"
          action="/draft-orders"
          className="flex flex-wrap items-end gap-3"
        >
          {status !== undefined && <input type="hidden" name="status" value={status} />}
          <div className="flex min-w-60 flex-1 flex-col gap-1.5">
            <Label htmlFor="drafts-search" className="sr-only">
              {d.searchLabel}
            </Label>
            <Input
              id="drafts-search"
              type="search"
              name="q"
              dir="auto"
              maxLength={200}
              defaultValue={q ?? ""}
              placeholder={d.searchPlaceholder}
              aria-label={d.searchLabel}
            />
          </div>
          <Button type="submit" variant="outline">
            <SearchIcon aria-hidden="true" />
            {d.search}
          </Button>
        </form>
        {content}
      </div>
    </AppShell>
  );
}

function StatePanel({
  icon,
  message,
  detail,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly detail?: string;
}) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
        {icon}
        <p role="note" className="text-foreground font-medium">
          {message}
        </p>
        {detail !== undefined && <p className="max-w-md text-sm">{detail}</p>}
      </CardContent>
    </Card>
  );
}
