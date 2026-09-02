import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { RedirectDto } from "@/lib/api/seo";
import type { Dictionary } from "@/messages/en";

export function RedirectsTable({
  redirects,
  t,
}: {
  readonly redirects: readonly RedirectDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.redirectsPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.redirectsPage.columns.fromPath}</TableHead>
          <TableHead>{t.redirectsPage.columns.toPath}</TableHead>
          <TableHead>{t.redirectsPage.columns.statusCode}</TableHead>
          <TableHead>{t.redirectsPage.columns.active}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {redirects.map((redirect) => (
          <TableRow key={redirect.id}>
            <TableCell className="font-mono text-xs font-medium">{redirect.fromPath}</TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">
              {redirect.toPath}
            </TableCell>
            <TableCell className="text-muted-foreground">{redirect.statusCode}</TableCell>
            <TableCell>
              <Badge variant={redirect.active ? "success" : "neutral"}>
                {redirect.active ? t.redirectsPage.active : t.redirectsPage.inactive}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
