import Link from "next/link";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { LocaleDto } from "@/lib/api/localization";
import type { Dictionary } from "@/messages/en";

export function LocalesTable({
  locales,
  t,
}: {
  readonly locales: readonly LocaleDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.localesPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.localesPage.columns.code}</TableHead>
          <TableHead>{t.localesPage.columns.name}</TableHead>
          <TableHead>{t.localesPage.columns.default}</TableHead>
          <TableHead>{t.localesPage.columns.status}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {locales.map((locale) => (
          <TableRow key={locale.id}>
            <TableCell className="font-mono font-medium whitespace-nowrap">
              <Link href={`/locales/${locale.id}`} className="hover:text-primary">
                {locale.code}
              </Link>
            </TableCell>
            <TableCell>{locale.name}</TableCell>
            <TableCell>
              {locale.isDefault ? (
                <Badge variant="accent">{t.localesPage.defaultYes}</Badge>
              ) : (
                <span className="text-muted-foreground text-sm">{t.localesPage.defaultNo}</span>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {locale.status}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
