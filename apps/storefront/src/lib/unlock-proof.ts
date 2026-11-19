import { cookies } from "next/headers";
import { ACCESS_COOKIE, verifyAccessCookie } from "./access-cookie";
import { getPublicAccess } from "./online-store";
import { currentShopId } from "./runtime-api";
import { storefrontSecrets } from "./storefront-env";

/**
 * Does this request hold a valid unlock cookie for its shop's CURRENT access version? Checked on
 * the server, never inferred from a request header: on paths the middleware skips (`/favicon.ico`,
 * say) a client's copy of any header reaches the page unstripped (task 9 review, minor 1).
 *
 * No cookie is `false` without a Runtime call. Otherwise one uncached access read (3 s timeout) and
 * the host-only HMAC check the middleware makes. Any failure is `false`: a refused or failed read, a
 * store the Runtime calls unlocked (the shell disagrees), no secret, no resolvable shop.
 */
export async function holdsValidUnlock(): Promise<boolean> {
  try {
    const value = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (value === undefined) return false;
    const access = await getPublicAccess();
    if (access === null || !access.locked) return false;
    return await verifyAccessCookie(value, {
      secret: storefrontSecrets().accessSecret,
      shopId: await currentShopId(),
      accessVersion: access.accessVersion,
      nowUnix: Math.floor(Date.now() / 1000),
    });
  } catch {
    return false;
  }
}
