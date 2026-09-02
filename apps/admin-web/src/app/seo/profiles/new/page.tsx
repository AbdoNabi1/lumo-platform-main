import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { SeoProfileForm } from "@/components/seo/seo-profile-form";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface NewSeoProfilePageProps {
  readonly searchParams: Promise<{
    readonly pageRef?: string;
    readonly title?: string;
    readonly description?: string;
    readonly canonicalUrl?: string;
    readonly ogImageRef?: string;
  }>;
}

/**
 * The SEO Profiles create/set screen (T5.9b), gated to `operator`+ by `middleware.ts`. Also serves
 * as the edit UI: `SeoProfileDetailPage`'s edit link pre-fills these query params with the
 * record's current values, since `POST /seo/profiles` create-or-updates keyed by `pageRef`.
 */
export default async function NewSeoProfilePage({ searchParams }: NewSeoProfilePageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const params = await searchParams;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
          <Link href="/seo/profiles">
            <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
            {t.seoProfileDetail.back}
          </Link>
        </Button>
        <h1 className="text-4xl font-semibold tracking-tight">{t.seoProfileForm.title}</h1>
        <p className="text-md text-muted-foreground mt-1">{t.seoProfileForm.subtitle}</p>
      </div>

      <Card>
        <CardContent>
          <SeoProfileForm t={t} defaultValues={params} />
        </CardContent>
      </Card>
    </div>
  );
}
