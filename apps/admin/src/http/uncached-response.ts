import type { TransportResponse } from "@platform/http";

/**
 * Marks a public storefront read as never storable by a shared cache in front of the Runtime. The
 * shell's draft is chosen by a header, and every public read is per shop (the tenant comes from a
 * header too), so a proxy that kept one would serve it to the wrong visitor or the wrong shop. The
 * storefront keeps its own per-shop cache (tagged `os:<shopId>`).
 */
export function uncached(response: TransportResponse): TransportResponse {
  return { ...response, headers: { ...response.headers, "cache-control": "private, no-store" } };
}
