import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { RedirectCreateForm } from "@/components/seo/redirect-create-form";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** The Redirects create screen (T5.9b), gated to `operator`+ by `middleware.ts`. */
export default async function NewRedirectPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
          <Link href="/seo/redirects">
            <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
            {t.redirectCreate.back}
          </Link>
        </Button>
        <h1 className="text-4xl font-semibold tracking-tight">{t.redirectCreate.title}</h1>
        <p className="text-md text-muted-foreground mt-1">{t.redirectCreate.subtitle}</p>
      </div>

      <Card>
        <CardContent>
          <RedirectCreateForm t={t} />
        </CardContent>
      </Card>
    </div>
  );
}
