import Link from "next/link";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import { pickText } from "@platform/storefront-content";
import type { PageDto } from "@/lib/api/pages";
import type { Locale } from "@/lib/i18n";
import { isStorefrontPagePath } from "@/lib/pages/route-path";
import type { Dictionary } from "@/messages/en";
import { PageStatusBadge } from "./page-status-badge";

/**
 * The pages list: each page by its title in the admin's language (its name when it has no title,
 * Ruling 16), its address, and "Not on your storefront" for an address outside `/pages/`.
 */
export function PagesTable({
  pages,
  t,
  locale,
}: {
  readonly pages: readonly PageDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Table aria-label={t.pagesPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.pagesPage.columns.title}</TableHead>
          <TableHead>{t.pagesPage.columns.routePath}</TableHead>
          <TableHead>{t.pagesPage.columns.status}</TableHead>
          <TableHead>{t.pagesPage.columns.template}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pages.map((page) => {
          const title = pickText(page.title, locale) ?? page.name;
          return (
            <TableRow key={page.id}>
              <TableCell className="font-medium">
                <Link
                  href={`/pages/${encodeURIComponent(page.id)}`}
                  className="hover:text-primary"
                  aria-label={t.pagesPage.viewPage.replace("{name}", title)}
                >
                  <bdi dir="auto">{title}</bdi>
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-mono">
                    {page.routePath}
                  </span>
                  {isStorefrontPagePath(page.routePath) ? null : (
                    <Badge variant="outline">{t.pageEditor.notOnStorefront}</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <PageStatusBadge status={page.status} t={t} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {page.templateRef ?? t.pagesPage.noneAssigned}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
