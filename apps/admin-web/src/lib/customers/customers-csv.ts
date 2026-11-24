import type { CustomerExportRowDto } from "@/lib/api/customers";
import { csvCell } from "@/lib/orders/orders-csv";
import type { Dictionary } from "@/messages/en";

/** The CSV's columns, in the plan's order; each header comes from `t.customersExport.columns`. */
export const CUSTOMERS_CSV_COLUMNS = [
  "name",
  "email",
  "phone",
  "language",
  "emailMarketing",
  "smsMarketing",
  "tags",
  "note",
  "address",
  "city",
  "postalCode",
  "country",
  "guest",
] as const;

const BOM = "\uFEFF";
const CRLF = "\r\n";

/**
 * The whole file: BOM (so Excel reads Arabic), the header row in the admin's language, one row per
 * customer, CRLF line ends. Every cell goes through `csvCell` — the orders export's formula-injection
 * guard and RFC 4180 quoting — so a name like `=SUM(1)` is neutralised while a phone number such as
 * `+201001234567` reaches the spreadsheet as typed. The marketing columns are the staff-asserted state,
 * not proof of opt-in.
 */
export function buildCustomersCsv(
  rows: readonly CustomerExportRowDto[],
  options: { readonly t: Dictionary },
): string {
  const { t } = options;
  const x = t.customersExport;
  const yesNo = (value: boolean): string => (value ? x.yes : x.no);
  const header = CUSTOMERS_CSV_COLUMNS.map((column) => csvCell(x.columns[column])).join(",");
  const body = rows.map((row) =>
    [
      row.name,
      row.email,
      row.phone ?? "",
      row.language ?? "",
      yesNo(row.emailMarketing),
      yesNo(row.smsMarketing),
      row.tags.join(", "),
      row.note ?? "",
      row.address?.line1 ?? "",
      row.address?.city ?? "",
      row.address?.postalCode ?? "",
      row.address?.country ?? "",
      yesNo(row.isGuest),
    ]
      .map(csvCell)
      .join(","),
  );
  return BOM + [header, ...body].join(CRLF) + CRLF;
}
