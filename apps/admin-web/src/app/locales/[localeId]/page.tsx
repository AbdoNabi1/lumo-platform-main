import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, GlobeIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Badge, Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { fetchLocale } from "@/lib/api/localization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface LocaleDetailPageProps {
  readonly params: Promise<{ readonly localeId: string }>;
}

/**
 * The Locale Detail screen (T5.11a) — read-only, per the task brief: no update or delete route
 * exists for locales, so `isDefault`/`status` are shown but never editable here. Resolves the real
 * `GET /locales/:localeId` endpoint (`localization:read`) and renders every `LocaleDto` field.
 */
export default async function LocaleDetailPage({ params }: LocaleDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { localeId } = await params;

  const result = await fetchLocale(localeId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="locales" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.localeDetail.unauthorized}
          backLabel={t.localeDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="locales" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.localeDetail.notFound}
          backLabel={t.localeDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="locales" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.localeDetail.error}
          backLabel={t.localeDetail.back}
        />
      </AppShell>
    );
  }

  const item = result.locale;

  return (
    <AppShell t={t} locale={locale} activeNavId="locales" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/locales">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.localeDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-center gap-2 text-4xl font-semibold tracking-tight">
              <GlobeIcon aria-hidden="true" className="size-7" />
              {item.name}
            </h1>
            {item.isDefault && <Badge variant="accent">{t.localeDetail.defaultBadge}</Badge>}
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{item.code}</p>
        </div>

        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t.localeDetail.code} value={item.code} />
            <Field label={t.localeDetail.name} value={item.name} />
            <Field
              label={t.localeDetail.isDefault}
              value={item.isDefault ? t.localeDetail.yes : t.localeDetail.no}
            />
            <Field label={t.localeDetail.status} value={item.status} />
            <Field
              label={t.localeDetail.fallbackLocaleRef}
              value={item.fallbackLocaleRef ?? t.localeDetail.none}
            />
          </CardContent>
        </Card>
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
            <Link href="/locales">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
