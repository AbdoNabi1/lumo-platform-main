import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { fetchOrderExportRows } from "@/lib/api/orders";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { buildOrdersCsv } from "@/lib/orders/orders-csv";
import { collectExportRows, parseExportRequest } from "@/lib/orders/orders-export";
import { zonedDay } from "@/lib/orders/zoned-time";
import { publicOrigin } from "@/lib/public-origin";

/**
 * Shopify's "Export orders" (spec §1.5): the dialog submits here (GET, server side), this pages
 * `GET /orders/export-rows` 250 at a time and answers `orders_export_<shop-local date>.csv` — UTF-8
 * with a BOM so Excel reads Arabic. Over 5,000 orders, a failure or a malformed request goes back to
 * the list with `?exportError=` instead of a partial file.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const back = (error: "too_many" | "failed" | "invalid") =>
    NextResponse.redirect(new URL(`/orders?exportError=${error}`, publicOrigin(request)), 303);

  const settings = await storeSettingsOrDefaults();
  const plan = parseExportRequest(request.nextUrl.searchParams, settings.timezone);
  if (plan === null) return back("invalid");

  const collected = await collectExportRows(fetchOrderExportRows, plan);
  if (collected.outcome === "too_many") return back("too_many");
  if (collected.outcome !== "ok") return back("failed");

  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const csv = buildOrdersCsv(collected.rows, {
    t: dictionaryFor(locale),
    locale,
    timeZone: settings.timezone,
  });
  const day = zonedDay(new Date(), settings.timezone);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="orders_export_${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
