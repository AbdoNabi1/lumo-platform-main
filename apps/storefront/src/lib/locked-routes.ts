import { POLICY_SLUGS, POLICY_TYPES } from "@platform/storefront-content";

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Decision 34: pages a LOCKED store still serves to a visitor without access: the five policy
 * pages, `robots.txt` and `sitemap.xml` (Ruling 5). Only routes that really exist belong here:
 * anything else would render the root 404 for a locked shop (review M-1).
 *
 * The list is exact on purpose. Each pattern is anchored and names whole paths: no prefix, no
 * trailing slash, no case folding, no encoded look-alike (`refund%2Dpolicy` stays gated). The policy
 * alternation is the five fixed slugs, so `/policies/<anything else>` is gated before it reaches
 * the page (which refuses it again with an exact-match scan). There is deliberately no catch-all
 * route behind any of them (WHATWG normalises `%2e%2e` for middleware, Next's router does not).
 */
export const LOCKED_REACHABLE_ROUTES: readonly RegExp[] = Object.freeze([
  new RegExp(
    `^/policies/(${POLICY_TYPES.map((type) => escapeRegExp(POLICY_SLUGS[type])).join("|")})$`,
  ),
  /^\/robots\.txt$/,
  /^\/sitemap\.xml$/,
]);

/**
 * Set ONLY by the middleware (client-sent copies are stripped there), to `"1"`, on a request it let
 * through a locked store because the route is in `LOCKED_REACHABLE_ROUTES`: the page then renders
 * without the shop's chrome, and robots and the sitemap close up.
 */
export const LOCKED_VIEW_HEADER = "x-morbeh-locked-view";

export type LockedReach = "reachable" | "forbidden" | "gated";

/**
 * Review M-2: a listed route is reachable for GET and HEAD only; any other method there is
 * `forbidden` (403), so an action bundled into such a page never runs without access. A path no
 * route names is `gated` (302 to the password page, or 403 for a write).
 */
export function reachWhileLocked(
  pathname: string,
  method: string,
  routes: readonly RegExp[],
): LockedReach {
  if (!routes.some((route) => route.test(pathname))) return "gated";
  return method === "GET" || method === "HEAD" ? "reachable" : "forbidden";
}
