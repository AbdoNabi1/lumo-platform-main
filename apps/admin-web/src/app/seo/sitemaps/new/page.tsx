import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { SitemapCreateForm } from "@/components/seo/sitemap-create-form";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** The Sitemaps create screen (T5.9b), gated to `operator`+ by `middleware.ts`. */
export default async function NewSitemapPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
          <Link href="/seo/sitemaps">
            <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
            {t.sitemapCreate.back}
          </Link>
        </Button>
        <h1 className="text-4xl font-semibold tracking-tight">{t.sitemapCreate.title}</h1>
        <p className="text-md text-muted-foreground mt-1">{t.sitemapCreate.subtitle}</p>
      </div>

      <Card>
        <CardContent>
          <SitemapCreateForm t={t} />
        </CardContent>
      </Card>
    </div>
  );
}
