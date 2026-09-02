import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { ComponentCreateForm } from "@/components/components-library/component-create-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** The Component Library create screen (T5.9c) — gated to `operator`+ by `middleware.ts`. */
export default async function NewComponentPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="components-library" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/components-library">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.componentDetail.back}
            </Link>
          </Button>
          <h1 className="text-4xl font-semibold tracking-tight">{t.componentCreate.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.componentCreate.subtitle}</p>
        </div>

        <Card>
          <CardContent>
            <ComponentCreateForm t={t} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
