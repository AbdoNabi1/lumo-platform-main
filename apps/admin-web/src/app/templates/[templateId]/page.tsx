import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { TemplateLifecycleActions } from "@/components/templates/template-lifecycle-actions";
import { TemplateStatusBadge } from "@/components/templates/template-status-badge";
import { fetchTemplate } from "@/lib/api/pages";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface TemplateDetailPageProps {
  readonly params: Promise<{ readonly templateId: string }>;
}

/**
 * The Template Detail screen (T5.9a Part B). Resolves the real `GET /templates/:templateId`
 * endpoint (`pages:read`) and renders the field set plus the archive button
 * (`TemplateLifecycleActions`, gated by `lib/pages-lifecycle.ts`'s `templateCanArchive`).
 */
export default async function TemplateDetailPage({ params }: TemplateDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { templateId } = await params;

  const result = await fetchTemplate(templateId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="templates" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.templateDetail.unauthorized}
          backLabel={t.templateDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="templates" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.templateDetail.notFound}
          backLabel={t.templateDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="templates" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.templateDetail.error}
          backLabel={t.templateDetail.back}
        />
      </AppShell>
    );
  }

  const template = result.template;

  return (
    <AppShell t={t} locale={locale} activeNavId="templates" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/templates">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.templateDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tight">{template.name}</h1>
            <TemplateStatusBadge status={template.status} t={t} />
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {t.templateDetail.experienceRef}:{" "}
            <span className="font-mono">{template.experienceRef}</span>
          </p>
        </div>

        <Card>
          <CardContent>
            <TemplateLifecycleActions templateId={template.id} status={template.status} t={t} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
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
            <Link href="/templates">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
