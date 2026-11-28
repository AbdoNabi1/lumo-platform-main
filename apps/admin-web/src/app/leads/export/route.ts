import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { fetchLeadExportRows } from "@/lib/api/leads";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { collectLeadExportRows } from "@/lib/leads/leads-export";
import { buildLeadsCsv } from "@/lib/leads/leads-csv";
import { isLeadStatus, type LeadStatus } from "@/lib/leads/lead-status";
import { zonedDay } from "@/lib/orders/zoned-time";
import { publicOrigin } from "@/lib/public-origin";

/**
 * The Leads inbox's "Export CSV" (`GET /leads/export?status=`): pages `GET /leads/export-rows`
 * (250 at a time, at most 5,000 rows) and answers `leads_export_<shop-local date>.csv` — UTF-8 with
 * a BOM so Excel reads Arabic, CRLF, every cell formula-guarded. Operators and admins only (the
 * `leads:export` permission; a viewer is sent back before anything is read). A refusal, a failure,
 * an oversize list or a malformed filter goes back to the list with `?exportError=` instead of a
 * partial file.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const back = (error: "forbidden" | "invalid" | "too_many" | "failed") =>
    NextResponse.redirect(new URL(`/leads?exportError=${error}`, publicOrigin(request)), 303);

  const session = await readSession();
  const role = highestRole(session?.roles ?? []);
  if (role !== "admin" && role !== "operator") return back("forbidden");

  const rawStatus = request.nextUrl.searchParams.get("status")?.trim() ?? "";
  let status: LeadStatus | undefined;
  if (rawStatus.length > 0 && rawStatus !== "all") {
    if (!isLeadStatus(rawStatus)) return back("invalid");
    status = rawStatus;
  }

  const settings = await storeSettingsOrDefaults();
  const collected = await collectLeadExportRows(
    fetchLeadExportRows,
    status === undefined ? {} : { status },
  );
  if (collected.outcome === "unauthorized") return back("forbidden");
  if (collected.outcome === "too_many") return back("too_many");
  if (collected.outcome !== "ok") return back("failed");

  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const csv = buildLeadsCsv(collected.rows, {
    t: dictionaryFor(locale),
    locale,
    timeZone: settings.timezone,
  });
  const day = zonedDay(new Date(), settings.timezone);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads_export_${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
