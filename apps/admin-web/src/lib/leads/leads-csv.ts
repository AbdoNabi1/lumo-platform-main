import type { LeadDto } from "@/lib/api/leads";
import type { Locale } from "@/lib/i18n";
import { csvCell } from "@/lib/orders/orders-csv";
import { zonedDateTimeLabel } from "@/lib/orders/zoned-time";
import type { Dictionary } from "@/messages/en";

/** The CSV's columns, in order. */
export const LEADS_CSV_COLUMNS = [
  "date",
  "name",
  "phone",
  "email",
  "message",
  "status",
  "form",
  "pageUrl",
] as const;

const BOM = "\uFEFF";
const CRLF = "\r\n";

/**
 * The whole file: BOM (so Excel reads Arabic), header row in the admin's language, one row per lead,
 * CRLF line ends. Every cell — all of it typed by a visitor or a plain label — goes through
 * `csvCell`, which formula-guards (`=`, `@`, tab, CR, and `+`/`-` unless phone-shaped) and quotes.
 */
export function buildLeadsCsv(
  rows: readonly LeadDto[],
  options: { readonly t: Dictionary; readonly locale: Locale; readonly timeZone: string },
): string {
  const { t, timeZone } = options;
  const header = LEADS_CSV_COLUMNS.map((column) => csvCell(t.leadsExport.columns[column])).join(
    ",",
  );
  const body = rows.map((row) =>
    [
      zonedDateTimeLabel(row.createdAt, timeZone),
      row.name,
      row.phone,
      row.email ?? "",
      row.message ?? "",
      (t.leadStatus as Record<string, string>)[row.status] ?? row.status,
      row.formId,
      row.pageUrl ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return BOM + [header, ...body].join(CRLF) + CRLF;
}
