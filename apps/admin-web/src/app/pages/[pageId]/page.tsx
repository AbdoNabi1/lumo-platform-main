import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { PageLifecycleActions } from "@/components/pages/page-lifecycle-actions";
import { PageStatusBadge } from "@/components/pages/page-status-badge";
import { fetchPage } from "@/lib/api/pages";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface PageDetailPageProps {
  readonly params: Promise<{ readonly pageId: string }>;
}

/**
 * The Page Detail screen (T5.9a Part B). Resolves the real `GET /pages/:pageId` endpoint
 * (`pages:read`) and renders the field set plus the "advance to…" lifecycle control
 * (`PageLifecycleActions`, gated by `lib/pages-lifecycle.ts`).
 */
export default async function PageDetailPage({ params }: PageDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { pageId } = await params;

  const result = await fetchPage(pageId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="pages" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.pageDetail.unauthorized}
          backLabel={t.pageDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="pages" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.pageDetail.notFound}
          backLabel={t.pageDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="pages" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.pageDetail.error}
          backLabel={t.pageDetail.back}
        />
      </AppShell>
    );
  }

  const page = result.page;

  return (
    <AppShell t={t} locale={locale} activeNavId="pages" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/pages">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.pageDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tight">{page.name}</h1>
            <PageStatusBadge status={page.status} t={t} />
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{page.routePath}</p>
        </div>

        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t.pageDetail.templateRef} value={page.templateRef} t={t} />
            <Field label={t.pageDetail.experienceRef} value={page.experienceRef} t={t} />
            <Field label={t.pageDetail.seoProfileRef} value={page.seoProfileRef} t={t} />
            <Field label={t.pageDetail.localeRef} value={page.localeRef} t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <PageLifecycleActions pageId={page.id} status={page.status} t={t} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  value,
  t,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly t: { readonly pageDetail: { readonly none: string } };
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono text-sm">{value ?? t.pageDetail.none}</span>
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
            <Link href="/pages">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
