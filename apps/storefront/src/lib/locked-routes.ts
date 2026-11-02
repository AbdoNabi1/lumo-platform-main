/**
 * Decision 34: pages a LOCKED store still serves to a visitor without access (policies, robots,
 * sitemap). Only routes that really exist belong here: anything else would render the root 404
 * inside the shop's own chrome (review M-1). Part 1 has none, so every such path is gated; Part 2
 * adds `/policies/<handle>`, `/robots.txt` and `/sitemap.xml` as it builds them.
 */
export const LOCKED_REACHABLE_ROUTES: readonly RegExp[] = [];

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
