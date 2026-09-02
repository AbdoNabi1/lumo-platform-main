import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { SitemapDto } from "@/lib/api/seo";
import type { Dictionary } from "@/messages/en";

export function SitemapsTable({
  sitemaps,
  t,
}: {
  readonly sitemaps: readonly SitemapDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.sitemapsPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.sitemapsPage.columns.name}</TableHead>
          <TableHead>{t.sitemapsPage.columns.urlCount}</TableHead>
          <TableHead>{t.sitemapsPage.columns.lastGeneratedAt}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sitemaps.map((sitemap) => (
          <TableRow key={sitemap.id}>
            <TableCell className="font-medium">
              <Link
                href={`/seo/sitemaps/${sitemap.id}`}
                className="hover:text-primary"
                aria-label={t.sitemapsPage.viewSitemap.replace("{name}", sitemap.name)}
              >
                {sitemap.name}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">{sitemap.urls.length}</TableCell>
            <TableCell className="text-muted-foreground">
              {sitemap.lastGeneratedAt ?? t.sitemapsPage.neverGenerated}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
