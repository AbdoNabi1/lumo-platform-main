/**
 * IP / CIDR primitives for the per-store block list (Tracking P1-D9).
 *
 * In-house and dependency-free: the block list holds a few hundred entries at most, so a linear scan over
 * `bigint` prefixes is plenty, and the runtime takes on no new package. IPv4 and IPv6 are both supported; an
 * IPv4-mapped IPv6 address (`::ffff:203.0.113.7`, what a dual-stack socket reports) is the IPv4 address, so a
 * block on `203.0.113.7` also holds when the visitor arrives that way.
 *
 * Two guard rails are policy, not syntax: an entry must be at least a /16 (IPv4) or /32 (IPv6) wide, so a typo
 * like `0.0.0.0/0` can never switch tracking off for the whole shop; and every entry is stored in ONE canonical
 * spelling, so adding the same range twice in different spellings is a no-op.
 */

export type IpFamily = 4 | 6;

export interface ParsedIp {
  readonly family: IpFamily;
  readonly value: bigint;
}

export interface ParsedCidr {
  readonly family: IpFamily;
  /** The network address with every host bit cleared. */
  readonly network: bigint;
  readonly prefix: number;
}

/** The narrowest range an entry may cover: wider than this is refused as a probable mistake. */
export const MIN_PREFIX: Readonly<Record<IpFamily, number>> = { 4: 16, 6: 32 };

const BITS: Readonly<Record<IpFamily, number>> = { 4: 32, 6: 128 };

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;

function parseIpv4(text: string): bigint | null {
  const match = IPV4.exec(text);
  if (match === null) return null;
  let value = 0n;
  for (let index = 1; index <= 4; index += 1) {
    const part = match[index] as string;
    // `010` is ambiguous (octal in some parsers): refuse it rather than guess.
    if (part.length > 1 && part.startsWith("0")) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIpv6(text: string): bigint | null {
  if (text.includes("%") || text === "") return null;
  let head = text;
  let tail4: bigint | null = null;

  // A dotted IPv4 tail (`::ffff:1.2.3.4`) stands for the last two groups.
  const lastColon = text.lastIndexOf(":");
  if (lastColon >= 0 && text.slice(lastColon + 1).includes(".")) {
    tail4 = parseIpv4(text.slice(lastColon + 1));
    if (tail4 === null) return null;
    head = `${text.slice(0, lastColon + 1)}0:0`;
  }

  const halves = head.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/iu.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };

  const left = parseGroups(halves[0] as string);
  const right = halves.length === 2 ? parseGroups(halves[1] as string) : [];
  if (left === null || right === null) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length;
    // `::` stands for at least one group of zeros.
    if (missing < 1) return null;
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    if (left.length !== 8) return null;
    groups = left;
  }

  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  if (tail4 !== null) value = (value & ~0xffffffffn) | tail4;
  return value;
}

const MAPPED_PREFIX = 0xffffn << 32n;

/** Parses a bare IPv4 or IPv6 address; an IPv4-mapped IPv6 address becomes the IPv4 address. */
export function parseIp(text: string): ParsedIp | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const v4 = parseIpv4(trimmed);
  if (v4 !== null) return { family: 4, value: v4 };
  const v6 = parseIpv6(trimmed);
  if (v6 === null) return null;
  if (v6 >> 32n === MAPPED_PREFIX >> 32n) return { family: 4, value: v6 & 0xffffffffn };
  return { family: 6, value: v6 };
}

function maskOf(family: IpFamily, prefix: number): bigint {
  const bits = BITS[family];
  if (prefix === 0) return 0n;
  return ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
}

/**
 * Parses `203.0.113.0/24`, `2001:db8::/32` or a bare address (a single host: /32 or /128). Host bits are
 * cleared, so `203.0.113.77/24` is the range `203.0.113.0/24`. Returns `null` for anything malformed or wider
 * than {@link MIN_PREFIX}.
 */
export function parseCidr(text: string): ParsedCidr | null {
  const trimmed = text.trim();
  const slash = trimmed.indexOf("/");
  const addressText = slash < 0 ? trimmed : trimmed.slice(0, slash);
  const address = parseIp(addressText);
  if (address === null) return null;

  let prefix = BITS[address.family];
  if (slash >= 0) {
    const prefixText = trimmed.slice(slash + 1);
    if (!/^\d{1,3}$/u.test(prefixText)) return null;
    prefix = Number(prefixText);
    // A mapped IPv6 range (`::ffff:1.2.3.0/120`) is the IPv4 range with the prefix shifted back.
    if (address.family === 4 && /:/u.test(addressText)) prefix -= 96;
  }
  if (prefix < MIN_PREFIX[address.family] || prefix > BITS[address.family]) return null;
  return {
    family: address.family,
    network: address.value & maskOf(address.family, prefix),
    prefix,
  };
}

function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join(".");
}

function formatIpv6(value: bigint): string {
  const groups: number[] = [];
  for (let index = 7; index >= 0; index -= 1) {
    groups.push(Number((value >> BigInt(index * 16)) & 0xffffn));
  }
  // RFC 5952: the longest run of zero groups (length >= 2; the first on a tie) becomes `::`.
  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < 8;) {
    if (groups[start] !== 0) {
      start += 1;
      continue;
    }
    let end = start;
    while (end < 8 && groups[end] === 0) end += 1;
    if (end - start > bestLength) {
      bestStart = start;
      bestLength = end - start;
    }
    start = end;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestLength < 2) return hex.join(":");
  const before = hex.slice(0, bestStart).join(":");
  const after = hex.slice(bestStart + bestLength).join(":");
  return `${before}::${after}`;
}

/** The one canonical spelling of an address. */
export function formatIp(ip: ParsedIp): string {
  return ip.family === 4 ? formatIpv4(ip.value) : formatIpv6(ip.value);
}

/** The one canonical spelling of a range: `network/prefix`, a host as `/32` or `/128`. */
export function formatCidr(cidr: ParsedCidr): string {
  return `${formatIp({ family: cidr.family, value: cidr.network })}/${String(cidr.prefix)}`;
}

/** Parses and re-spells an entry; `null` when it is not a valid, wide-enough address or range. */
export function normalizeCidr(text: string): string | null {
  const parsed = parseCidr(text);
  return parsed === null ? null : formatCidr(parsed);
}

/** True when `ip` lies inside `cidr`. A different family never matches. */
export function cidrContains(cidr: ParsedCidr, ip: ParsedIp): boolean {
  if (cidr.family !== ip.family) return false;
  return (ip.value & maskOf(cidr.family, cidr.prefix)) === cidr.network;
}

export type IpMatcher = (ip: string | null | undefined) => boolean;

/** Compiles stored entries into one matcher. An entry that does not parse is skipped, never thrown on. */
export function compileIpMatcher(entries: readonly string[]): IpMatcher {
  const ranges: ParsedCidr[] = [];
  for (const entry of entries) {
    const parsed = parseCidr(entry);
    if (parsed !== null) ranges.push(parsed);
  }
  return (ip) => {
    if (ip === null || ip === undefined || ranges.length === 0) return false;
    const parsed = parseIp(ip);
    return parsed !== null && ranges.some((range) => cidrContains(range, parsed));
  };
}

/**
 * The address truncated to the network that identifies a household / mobile cell rather than one device:
 * IPv4 /24, IPv6 /48. `null` for something that is not an address. Used by the fingerprint, never to block.
 */
export function ipPrefixKey(ip: string | null | undefined): string | null {
  if (ip === null || ip === undefined) return null;
  const parsed = parseIp(ip);
  if (parsed === null) return null;
  const prefix = parsed.family === 4 ? 24 : 48;
  const network = parsed.value & maskOf(parsed.family, prefix);
  return `${formatIp({ family: parsed.family, value: network })}/${String(prefix)}`;
}

/**
 * True for an address that can belong to a visitor on the open internet. Loopback, private (RFC 1918), link-local,
 * carrier-grade-NAT shared space, multicast and unspecified addresses are not: a list entry for one of them would
 * be meaningless, and "exclude this device" answering with one means the caller's real address was not seen (a
 * proxy in between), so the request is refused rather than silently excluding the proxy.
 */
export function isPublicIp(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return false;
  const ip = parseIp(text);
  if (ip === null) return false;
  if (ip.family === 4) {
    const v = ip.value;
    const inRange = (base: bigint, prefix: number): boolean => (v & maskOf(4, prefix)) === base;
    const octets = (a: number, b: number, c: number, d: number): bigint =>
      (BigInt(a) << 24n) | (BigInt(b) << 16n) | (BigInt(c) << 8n) | BigInt(d);
    return !(
      inRange(octets(0, 0, 0, 0), 8) ||
      inRange(octets(10, 0, 0, 0), 8) ||
      inRange(octets(100, 64, 0, 0), 10) ||
      inRange(octets(127, 0, 0, 0), 8) ||
      inRange(octets(169, 254, 0, 0), 16) ||
      inRange(octets(172, 16, 0, 0), 12) ||
      inRange(octets(192, 0, 0, 0), 24) ||
      inRange(octets(192, 168, 0, 0), 16) ||
      inRange(octets(224, 0, 0, 0), 4) ||
      inRange(octets(240, 0, 0, 0), 4)
    );
  }
  const v = ip.value;
  if (v === 0n || v === 1n) return false; // :: and ::1
  const top = Number(v >> 112n);
  if ((top & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((top & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((top & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}
