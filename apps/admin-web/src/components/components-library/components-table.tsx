import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { ComponentDefinitionDto } from "@/lib/api/component-library";
import type { Dictionary } from "@/messages/en";
import { ComponentStatusBadge } from "./component-status-badge";

export function ComponentsTable({
  components,
  t,
}: {
  readonly components: readonly ComponentDefinitionDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.componentsPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.componentsPage.columns.name}</TableHead>
          <TableHead>{t.componentsPage.columns.key}</TableHead>
          <TableHead>{t.componentsPage.columns.status}</TableHead>
          <TableHead>{t.componentsPage.columns.responsive}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {components.map((component) => (
          <TableRow key={component.id}>
            <TableCell className="font-medium">
              <Link
                href={`/components-library/${component.id}`}
                className="hover:text-primary"
                aria-label={t.componentsPage.viewComponent.replace("{name}", component.name)}
              >
                {component.name}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">
              {component.key}
            </TableCell>
            <TableCell>
              <ComponentStatusBadge status={component.status} t={t} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {component.responsive ? t.componentsPage.yes : t.componentsPage.no}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
