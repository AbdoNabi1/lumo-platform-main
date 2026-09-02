import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { PageDto } from "@/lib/api/pages";
import type { Dictionary } from "@/messages/en";
import { PageStatusBadge } from "./page-status-badge";

export function PagesTable({
  pages,
  t,
}: {
  readonly pages: readonly PageDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.pagesPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.pagesPage.columns.name}</TableHead>
          <TableHead>{t.pagesPage.columns.routePath}</TableHead>
          <TableHead>{t.pagesPage.columns.status}</TableHead>
          <TableHead>{t.pagesPage.columns.template}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pages.map((page) => (
          <TableRow key={page.id}>
            <TableCell className="font-medium">
              <Link
                href={`/pages/${page.id}`}
                className="hover:text-primary"
                aria-label={t.pagesPage.viewPage.replace("{name}", page.name)}
              >
                {page.name}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">
              {page.routePath}
            </TableCell>
            <TableCell>
              <PageStatusBadge status={page.status} t={t} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {page.templateRef ?? t.pagesPage.noneAssigned}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
