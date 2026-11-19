import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { pickText } from "@platform/storefront-content";
import { AppShell } from "@/components/app-shell";
import { PageAddress, PageContentForm } from "@/components/pages/page-content-form";
import { PageLifecycleActions } from "@/components/pages/page-lifecycle-actions";
import { PageStatusBadge } from "@/components/pages/page-status-badge";
import { fetchPage } from "@/lib/api/pages";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface PageDetailPageProps {
  readonly params: Promise<{ readonly pageId: string }>;
}

/**
 * The page editor (T5.9a Part B, Part 2 spec 2.4): the title (its name when it has none, Ruling
 * 16), status, address with "Not on your storefront" or "View on store", the content form, and
 * Publish / Hide / Archive. The technical references sit under a collapsed "Advanced". Viewers
 * read it (`pages:read`); the role only decides what is editable — the API enforces every write.
 */
export default async function PageDetailPage({ params }: PageDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const { pageId } = await params;
  const [user, session, result] = await Promise.all([
    getCurrentUser(),
    readSession(),
    fetchPage(pageId),
  ]);
  const role = highestRole(session?.roles ?? []);
  const canEdit = role === "operator" || role === "admin";
  const storefrontUrl = process.env["STOREFRONT_URL"]?.trim() || null;

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
            <h1 className="text-2xl font-semibold tracking-tight">
              <bdi dir="auto">{pickText(page.title, locale) ?? page.name}</bdi>
            </h1>
            <PageStatusBadge status={page.status} t={t} />
          </div>
          <div className="mt-1">
            <PageAddress
              t={t}
              routePath={page.routePath}
              status={page.status}
              storefrontUrl={storefrontUrl}
            />
          </div>
        </div>

        <Card>
          <CardContent>
            <PageContentForm
              t={t}
              locale={locale}
              page={page}
              canEdit={canEdit}
              storefrontUrl={storefrontUrl}
            />
          </CardContent>
        </Card>

        {canEdit ? (
          <Card>
            <CardContent>
              <PageLifecycleActions t={t} pageId={page.id} status={page.status} canEdit={canEdit} />
            </CardContent>
          </Card>
        ) : null}

        <details className="border-border bg-card rounded-xl border px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">{t.pageEditor.advanced}</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t.pageDetail.templateRef} value={page.templateRef} t={t} />
            <Field label={t.pageDetail.experienceRef} value={page.experienceRef} t={t} />
            <Field label={t.pageDetail.seoProfileRef} value={page.seoProfileRef} t={t} />
            <Field label={t.pageDetail.localeRef} value={page.localeRef} t={t} />
          </div>
        </details>
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
