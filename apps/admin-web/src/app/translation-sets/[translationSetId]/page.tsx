import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  LanguagesIcon,
  LockIcon,
  SearchXIcon,
} from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { TranslationSetTranslations } from "@/components/translation-sets/translation-set-translations";
import { fetchTranslationSet } from "@/lib/api/localization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface TranslationSetDetailPageProps {
  readonly params: Promise<{ readonly translationSetId: string }>;
}

/**
 * The Translation Set Detail screen (T5.11a). Resolves the real
 * `GET /translation-sets/:translationSetId` endpoint (`localization:read`) and renders every
 * `TranslationSetDto` field, including the `translations` table with the upsert/publish controls
 * (`TranslationSetTranslations`). Reachable by any authenticated viewer (`middleware.ts` gates only
 * `/translation-sets/new` to operator+); every write action here is independently
 * permission-gated server-side, same precedent as every prior Phase 5 detail-page write action.
 */
export default async function TranslationSetDetailPage({
  params,
}: TranslationSetDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { translationSetId } = await params;

  const result = await fetchTranslationSet(translationSetId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="translation-sets" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.translationSetDetail.unauthorized}
          backLabel={t.translationSetDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="translation-sets" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.translationSetDetail.notFound}
          backLabel={t.translationSetDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="translation-sets" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.translationSetDetail.error}
          backLabel={t.translationSetDetail.back}
        />
      </AppShell>
    );
  }

  const set = result.translationSet;

  return (
    <AppShell t={t} locale={locale} activeNavId="translation-sets" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/translation-sets">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.translationSetDetail.back}
            </Link>
          </Button>

          <h1 className="flex items-center gap-2 text-4xl font-semibold tracking-tight">
            <LanguagesIcon aria-hidden="true" className="size-7" />
            {set.namespace}
          </h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{set.localeRef}</p>
        </div>

        <TranslationSetTranslations
          translationSetId={set.id}
          translations={set.translations}
          t={t}
        />
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
            <Link href="/translation-sets">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
