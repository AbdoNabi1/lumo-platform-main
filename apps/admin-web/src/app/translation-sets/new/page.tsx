import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { TranslationSetCreateForm } from "@/components/translation-sets/translation-set-create-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** The translation set create screen (T5.11a) — gated to `operator`+ by `middleware.ts`. */
export default async function NewTranslationSetPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="translation-sets" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/translation-sets">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.translationSetsPage.title}
            </Link>
          </Button>
          <h1 className="text-4xl font-semibold tracking-tight">
            {t.translationSetCreateForm.title}
          </h1>
          <p className="text-md text-muted-foreground mt-1">
            {t.translationSetCreateForm.subtitle}
          </p>
        </div>

        <Card>
          <CardContent>
            <TranslationSetCreateForm t={t} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
