import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { LeadDto } from "@/lib/api/leads";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { LeadStatusBadge } from "./lead-status-badge";

const EXCERPT_MAX_LENGTH = 80;

/** The first 80 characters of the message — the whole text is on the detail page. */
function excerptOf(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= EXCERPT_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, EXCERPT_MAX_LENGTH)}…`;
}

export function LeadsTable({
  leads,
  t,
  locale,
}: {
  readonly leads: readonly LeadDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Table aria-label={t.leadsPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t.leadsPage.columns.date}</TableHead>
          <TableHead scope="col">{t.leadsPage.columns.name}</TableHead>
          <TableHead scope="col">{t.leadsPage.columns.phone}</TableHead>
          <TableHead scope="col">{t.leadsPage.columns.email}</TableHead>
          <TableHead scope="col">{t.leadsPage.columns.message}</TableHead>
          <TableHead scope="col">{t.leadsPage.columns.status}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((lead) => (
          <TableRow key={lead.id}>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {formatDateTime(locale, lead.createdAt)}
            </TableCell>
            <TableCell className="font-medium">
              <Link href={`/leads/${encodeURIComponent(lead.id)}`} className="hover:text-primary">
                <bdi dir="auto">{lead.name}</bdi>
              </Link>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <bdi dir="ltr">{lead.phone}</bdi>
            </TableCell>
            <TableCell>{lead.email === null ? "—" : <bdi dir="ltr">{lead.email}</bdi>}</TableCell>
            <TableCell className="max-w-md">
              {lead.message === null || lead.message.trim().length === 0 ? (
                "—"
              ) : (
                <bdi dir="auto">{excerptOf(lead.message)}</bdi>
              )}
            </TableCell>
            <TableCell>
              <LeadStatusBadge status={lead.status} t={t} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
