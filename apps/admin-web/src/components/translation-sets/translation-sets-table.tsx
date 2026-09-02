import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { TranslationSetDto } from "@/lib/api/localization";
import type { Dictionary } from "@/messages/en";

export function TranslationSetsTable({
  translationSets,
  t,
}: {
  readonly translationSets: readonly TranslationSetDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.translationSetsPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.translationSetsPage.columns.namespace}</TableHead>
          <TableHead>{t.translationSetsPage.columns.locale}</TableHead>
          <TableHead className="text-end">{t.translationSetsPage.columns.translations}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {translationSets.map((set) => (
          <TableRow key={set.id}>
            <TableCell className="font-medium whitespace-nowrap">
              <Link href={`/translation-sets/${set.id}`} className="hover:text-primary">
                {set.namespace}
              </Link>
            </TableCell>
            <TableCell className="font-mono text-sm">{set.localeRef}</TableCell>
            <TableCell className="text-end tabular-nums">{set.translations.length}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
