import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { fetchCustomerExportPage } from "@/lib/api/customers";
import {
  collectCustomerExportRows,
  parseCustomerExportRequest,
} from "@/lib/customers/customers-export";
import { buildCustomersCsv } from "@/lib/customers/customers-csv";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { publicOrigin } from "@/lib/public-origin";

/**
 * "Export customers": the dialog submits here (GET, server side), this pages
 * `GET /customers/export-rows` 100 at a time and answers `customers_export.csv` — UTF-8 with a BOM
 * so Excel reads Arabic. The API enforces `customers:export` (a viewer's 403 comes back as a failed
 * page). Over 5,000 customers, a failure or a malformed request goes back to the list with
 * `?exportError=` instead of a partial file.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const back = (error: "too_many" | "failed") =>
    NextResponse.redirect(new URL(`/customers?exportError=${error}`, publicOrigin(request)), 303);

  const plan = parseCustomerExportRequest(request.nextUrl.searchParams);
  if (plan === null) return back("failed");

  const collected = await collectCustomerExportRows(fetchCustomerExportPage, plan);
  if (collected.outcome === "too_many") return back("too_many");
  if (collected.outcome !== "ok") return back("failed");

  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const csv = buildCustomersCsv(collected.rows, { t: dictionaryFor(locale) });
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="customers_export.csv"',
      "cache-control": "no-store",
    },
  });
}
