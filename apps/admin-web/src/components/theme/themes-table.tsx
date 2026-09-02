import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { ThemeDto } from "@/lib/api/theme";
import type { Dictionary } from "@/messages/en";
import { ThemeStatusBadge } from "./theme-status-badge";

export function ThemesTable({
  themes,
  t,
}: {
  readonly themes: readonly ThemeDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.themesPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.themesPage.columns.name}</TableHead>
          <TableHead>{t.themesPage.columns.status}</TableHead>
          <TableHead>{t.themesPage.columns.versions}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {themes.map((theme) => (
          <TableRow key={theme.id}>
            <TableCell className="font-medium">
              <Link
                href={`/theme/${theme.id}`}
                className="hover:text-primary"
                aria-label={t.themesPage.viewTheme.replace("{name}", theme.name)}
              >
                {theme.name}
              </Link>
            </TableCell>
            <TableCell>
              <ThemeStatusBadge status={theme.status} t={t} />
            </TableCell>
            <TableCell className="text-muted-foreground">{theme.versions.length}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
