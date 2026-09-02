import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { ThemeLifecycleActions } from "@/components/theme/theme-lifecycle-actions";
import { ThemeStatusBadge } from "@/components/theme/theme-status-badge";
import { ThemeVariablesEditor } from "@/components/theme/theme-variables-editor";
import { fetchTheme } from "@/lib/api/theme";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface ThemeDetailPageProps {
  readonly params: Promise<{ readonly themeId: string }>;
}

/**
 * The Theme Detail screen (T5.9c). Resolves the real `GET /themes/:themeId` endpoint
 * (`theme:read`) and renders name/status/versions plus the "advance to…" lifecycle control
 * (`ThemeLifecycleActions`, gated by `lib/theme-lifecycle.ts`) and, only when
 * `status === "draft"`, the variables editor (`ThemeVariablesEditor` — `POST
 * /themes/:themeId/variables` is draft-only per its own route summary).
 */
export default async function ThemeDetailPage({ params }: ThemeDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { themeId } = await params;

  const result = await fetchTheme(themeId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="theme" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.themeDetail.unauthorized}
          backLabel={t.themeDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="theme" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.themeDetail.notFound}
          backLabel={t.themeDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="theme" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.themeDetail.error}
          backLabel={t.themeDetail.back}
        />
      </AppShell>
    );
  }

  const theme = result.theme;

  return (
    <AppShell t={t} locale={locale} activeNavId="theme" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/theme">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.themeDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tight">{theme.name}</h1>
            <ThemeStatusBadge status={theme.status} t={t} />
          </div>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{t.themeDetail.versionsTitle}</h2>
            {theme.versions.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t.themeDetail.noVersions}</p>
            ) : (
              <Table aria-label={t.themeDetail.versionsTitle}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.themeDetail.versionNumber}</TableHead>
                    <TableHead>{t.themeDetail.publishedAt}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {theme.versions.map((version) => (
                    <TableRow key={version.versionNumber}>
                      <TableCell>{version.versionNumber}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {version.publishedAt}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <ThemeLifecycleActions themeId={theme.id} status={theme.status} t={t} />
          </CardContent>
        </Card>

        {theme.status === "draft" && (
          <Card>
            <CardContent>
              <h2 className="mb-4 text-lg font-semibold">{t.themeVariables.title}</h2>
              <ThemeVariablesEditor
                themeId={theme.id}
                colors={theme.colors}
                typography={theme.typography}
                spacing={theme.spacing}
                t={t}
              />
            </CardContent>
          </Card>
        )}
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
            <Link href="/theme">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
