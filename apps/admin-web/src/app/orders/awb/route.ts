import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { fetchAwbPdf } from "@/lib/api/carrier-shipments";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const NO_STORE = "private, no-store";

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": NO_STORE },
  });
}

/**
 * Proxies the waybill PDF so the bearer token stays server-side. The PDF is streamed to the
 * browser and never stored: every response says `private, no-store`.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);

  const params = new URL(request.url).searchParams;
  const orderIds = (params.get("orderIds") ?? "").split(",");
  const format = params.get("format");
  const lang = params.get("lang");
  if (
    orderIds.length < 1 ||
    orderIds.length > 50 ||
    !orderIds.every((id) => ID_PATTERN.test(id)) ||
    new Set(orderIds).size !== orderIds.length ||
    (format !== null && format !== "A4" && format !== "A6") ||
    (lang !== null && lang !== "ar" && lang !== "en")
  ) {
    return text(t.formErrors.invalid, 400);
  }

  const result = await fetchAwbPdf({
    orderIds,
    ...(format === null ? {} : { format }),
    ...(lang === null ? {} : { lang }),
  });
  switch (result.outcome) {
    case "ok":
      return new Response(result.bytes as BodyInit, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "cache-control": NO_STORE,
          "content-disposition": 'inline; filename="waybills.pdf"',
          "x-content-type-options": "nosniff",
        },
      });
    case "conflict":
      return text(
        result.orderNumbers.length > 0
          ? t.carrierShipping.awbNotAvailable.replace(
              "{orders}",
              result.orderNumbers.map((n) => `#${n}`).join("، "),
            )
          : t.carrierShipping.errors.AWB_NOT_AVAILABLE,
        409,
      );
    case "unauthorized":
      return text(t.formErrors.unauthorized, 401);
    case "not_found":
      return text(t.formErrors.notFound, 404);
    case "error":
      return text(t.formErrors.unexpected, 502);
  }
}
