import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { TemplateDto } from "@/lib/api/pages";
import type { Dictionary } from "@/messages/en";
import { TemplateStatusBadge } from "./template-status-badge";

export function TemplatesTable({
  templates,
  t,
}: {
  readonly templates: readonly TemplateDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.templatesPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.templatesPage.columns.name}</TableHead>
          <TableHead>{t.templatesPage.columns.experienceRef}</TableHead>
          <TableHead>{t.templatesPage.columns.status}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {templates.map((template) => (
          <TableRow key={template.id}>
            <TableCell className="font-medium">
              <Link
                href={`/templates/${template.id}`}
                className="hover:text-primary"
                aria-label={t.templatesPage.viewTemplate.replace("{name}", template.name)}
              >
                {template.name}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">
              {template.experienceRef}
            </TableCell>
            <TableCell>
              <TemplateStatusBadge status={template.status} t={t} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
