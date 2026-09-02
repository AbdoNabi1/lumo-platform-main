import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { SitemapRegenerateForm } from "@/components/seo/sitemap-regenerate-form";
import { fetchSitemap } from "@/lib/api/seo";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface SitemapDetailPageProps {
  readonly params: Promise<{ readonly sitemapId: string }>;
}

/**
 * The Sitemap Detail screen (T5.9b): shows `urls`/`lastGeneratedAt` and the "Regenerate" form
 * (`POST /seo/sitemaps/:sitemapId/regenerate`, a repeated-text-row array taking the new `urls`
 * list — see `SitemapRegenerateForm`). Resolves the real `GET /seo/sitemaps/:sitemapId` endpoint
 * (`seo:read`).
 */
export default async function SitemapDetailPage({ params }: SitemapDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const { sitemapId } = await params;

  const result = await fetchSitemap(sitemapId);

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.sitemapDetail.unauthorized}
        backLabel={t.sitemapDetail.back}
      />
    );
  }
  if (result.outcome === "not_found") {
    return (
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={t.sitemapDetail.notFound}
        backLabel={t.sitemapDetail.back}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.sitemapDetail.error}
        backLabel={t.sitemapDetail.back}
      />
    );
  }

  const sitemap = result.sitemap;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
          <Link href="/seo/sitemaps">
            <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
            {t.sitemapDetail.back}
          </Link>
        </Button>
        <h1 className="text-4xl font-semibold tracking-tight">{sitemap.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t.sitemapDetail.lastGeneratedAt}:{" "}
          <span className="font-mono">{sitemap.lastGeneratedAt ?? t.sitemapDetail.neverGenerated}</span>
        </p>
      </div>

      <Card>
        <CardContent>
          <h2 className="mb-3 text-lg font-semibold">{t.sitemapDetail.urlsTitle}</h2>
          {sitemap.urls.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.sitemapDetail.noUrls}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sitemap.urls.map((url) => (
                <li key={url} className="font-mono text-xs break-all">
                  {url}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <SitemapRegenerateForm sitemapId={sitemap.id} currentUrls={sitemap.urls} t={t} />
        </CardContent>
      </Card>
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
            <Link href="/seo/sitemaps">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
