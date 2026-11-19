const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/;
const PORT_MAX = 65_535;
const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * The origin robots.txt and the sitemap name, from the request's Host. Only a plain host name with
 * an optional port passes (lower-cased; no path, user info, spaces, `..` or anything XML would
 * have to escape), so nothing a client sends can shape the URL beyond its host. `http://` only for
 * a local host in development; everything else is `https://`. Null when the host is unusable.
 *
 * With host routing on, the middleware has already resolved this host to the shop; with it off,
 * any well-formed host is reflected (preflight 23, an accepted residual: nothing is cached by it).
 */
export function siteOrigin(rawHost: string | null, nodeEnv: string | undefined): string | null {
  if (rawHost === null) return null;
  const host = rawHost.toLowerCase();
  if (!HOST.test(host) || host.includes("..")) return null;
  const colon = host.indexOf(":");
  const name = colon === -1 ? host : host.slice(0, colon);
  if (name === "" || (colon !== -1 && Number(host.slice(colon + 1)) > PORT_MAX)) return null;
  const scheme = nodeEnv === "development" && DEV_HOSTS.has(name) ? "http" : "https";
  return `${scheme}://${host}`;
}
