/**
 * The visitor's address, trusted (Tracking P1-D7, gap §0.6).
 *
 * `X-Forwarded-For` is a list, `client, proxy1, proxy2, …`, and any caller can send its own copy of the header: the
 * LEFT-most entry is whatever the visitor typed, so it must never be believed (the old lead action did exactly
 * that, which let a form submitter choose the address its lead, its spam rate limit and its tracking profile carried).
 * Each proxy that WE operate appends the address of the peer it saw, so the entries those proxies wrote are the
 * right-most ones, and the real client is the right-most entry that is not one of our own proxies:
 *
 *     index = entries.length − trustedProxies
 *
 * - **Railway** puts one edge proxy in front of the service and that edge appends the client's address, so the
 *   default is `1`: the LAST entry. Whatever a visitor wrote before it sits to the left and is ignored.
 * - A deployment with a CDN or a second proxy in front of Railway sets `STOREFRONT_TRUSTED_PROXIES=2` (one more per
 *   additional proxy that appends to the header). Behind none (a dev server, an unproxied box) it is `0`: the
 *   header is then entirely client-controlled and NO address is returned — a missing address, never a forged one.
 * - Fewer entries than proxies means the request skipped part of the chain; the first entry was still written by a
 *   proxy of ours, so it is used rather than dropped.
 *
 * Only a syntactically valid IPv4/IPv6 address is returned (a `:port` suffix and IPv6 brackets are removed); anything
 * else — a hostname, an empty slot, 5 KB of text — yields `null`. This module is imported by the edge middleware and
 * a server action, so it has no state, logs nothing and uses no Node-only module (`node:net` is not in the Edge
 * runtime; the address check below is a few lines of its own).
 */
export const TRUSTED_PROXIES_ENV = "STOREFRONT_TRUSTED_PROXIES";
/** Railway's edge: one proxy that appends the client address. */
export const DEFAULT_TRUSTED_PROXIES = 1;
const MAX_TRUSTED_PROXIES = 8;
/** An address is at most 45 characters (IPv4-mapped IPv6); a longer list entry is not one. */
const MAX_ENTRY_LENGTH = 64;
/** More entries than any real chain: the header is hostile, and splitting it is not free. */
const MAX_ENTRIES = 32;

type Env = Readonly<Record<string, string | undefined>>;

/** `STOREFRONT_TRUSTED_PROXIES`: a whole number 0–8; unset, blank or malformed ⇒ the Railway default. */
export function trustedProxyCount(env: Env = process.env): number {
  // Literal key (not the constant): scripts/ops/check-env-docs.mjs finds env reads by their quoted name.
  const raw = env["STOREFRONT_TRUSTED_PROXIES"]?.trim();
  if (raw === undefined || raw === "" || !/^\d{1,2}$/u.test(raw)) return DEFAULT_TRUSTED_PROXIES;
  return Math.min(Number(raw), MAX_TRUSTED_PROXIES);
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/u;
const HEX_GROUP = /^[0-9a-fA-F]{1,4}$/u;

function isIpv6(value: string): boolean {
  if (!value.includes(":") || value.includes(":::")) return false;
  const halves = value.split("::");
  if (halves.length > 2) return false;
  const groupsOf = (part: string): string[] | null => (part === "" ? [] : part.split(":"));
  const head = groupsOf(halves[0] ?? "");
  const tail = halves.length === 2 ? groupsOf(halves[1] ?? "") : [];
  if (head === null || tail === null) return false;
  const all = [...head, ...tail];
  // An embedded IPv4 tail (`::ffff:203.0.113.7`) counts as two groups.
  const last = all[all.length - 1];
  let width = all.length;
  if (last !== undefined && last.includes(".")) {
    if (!IPV4.test(last)) return false;
    all.pop();
    width += 1;
  }
  if (!all.every((group) => HEX_GROUP.test(group))) return false;
  return halves.length === 2 ? width < 8 : width === 8;
}

const isAddress = (value: string): boolean => IPV4.test(value) || isIpv6(value);

/** Removes `[...]` brackets and a `:port` suffix, then keeps only a real IP address. */
function addressOf(entry: string): string | null {
  let value = entry.trim();
  if (value === "" || value.length > MAX_ENTRY_LENGTH) return null;
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/u.exec(value);
  if (bracketed?.[1] !== undefined) value = bracketed[1];
  else if (/^[^:]+:\d{1,5}$/u.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  return isAddress(value) ? value : null;
}

/**
 * The client address from an `x-forwarded-for` value, given how many of our own proxies appended to it. Pure.
 * `null` when there is no trustworthy address.
 */
export function clientIpFromForwardedFor(
  forwardedFor: string | null | undefined,
  proxies: number = DEFAULT_TRUSTED_PROXIES,
): string | null {
  if (proxies < 1 || forwardedFor === null || forwardedFor === undefined) return null;
  // A hostile header can be arbitrarily long; the chain that matters is the tail, so bound the work.
  const entries = forwardedFor.split(",", MAX_ENTRIES + 1);
  if (entries.length > MAX_ENTRIES) return null;
  const index = Math.max(0, entries.length - proxies);
  return addressOf(entries[index] ?? "");
}

/** The visitor's address for a request's headers, per the deployment's trusted-proxy count. */
export function trustedClientIp(
  headers: { get(name: string): string | null },
  env: Env = process.env,
): string | null {
  return clientIpFromForwardedFor(headers.get("x-forwarded-for"), trustedProxyCount(env));
}
