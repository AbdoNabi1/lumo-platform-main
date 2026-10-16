import { platformToolsEnabled } from "@/components/navigation";

/**
 * Whether this deployment shows the platform's engineering screens and tools — the "Platform
 * tools" menu group, and the id-typed operations some merchant pages keep for the team (stock
 * reservations, coupon redemption, orders from a checkout session, Customer 360 cards). Merchants
 * never see them; their routes stay reachable either way. Server-only: reads `ADMIN_PLATFORM_TOOLS`
 * per request, as `STOREFRONT_URL` is read (Plan 3C).
 */
export function showPlatformTools(): boolean {
  return platformToolsEnabled(process.env["ADMIN_PLATFORM_TOOLS"]);
}
