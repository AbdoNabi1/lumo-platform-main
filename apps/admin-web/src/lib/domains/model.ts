/**
 * Merchant domains: the shapes `GET/POST /store/domains…` answer, and the pure helpers a screen
 * needs. Import-free on purpose — client components may import this module, whereas `lib/api/*`
 * pulls `next/headers` into the browser bundle.
 */

/** Mirrors the runtime's `ShopDomainView`. */
export interface ShopDomainDto {
  readonly id: string;
  readonly shopId: string;
  readonly hostname: string;
  readonly kind: "platform" | "custom";
  readonly status: "pending" | "verified";
  readonly isPrimary: boolean;
  readonly verifiedAt: string | null;
}

export function isShopDomainDto(value: unknown): value is ShopDomainDto {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    typeof candidate["shopId"] === "string" &&
    typeof candidate["hostname"] === "string" &&
    (candidate["kind"] === "platform" || candidate["kind"] === "custom") &&
    (candidate["status"] === "pending" || candidate["status"] === "verified") &&
    typeof candidate["isPrimary"] === "boolean" &&
    (candidate["verifiedAt"] === null || typeof candidate["verifiedAt"] === "string")
  );
}

/** The domain customers are sent to, or null when none is flagged primary. */
export function primaryDomain(domains: readonly ShopDomainDto[]): ShopDomainDto | null {
  return domains.find((domain) => domain.isPrimary) ?? null;
}

/** The shop's free platform subdomain (every shop has exactly one). */
export function platformDomain(domains: readonly ShopDomainDto[]): ShopDomainDto | null {
  return domains.find((domain) => domain.kind === "platform") ?? null;
}

/**
 * Mirrors `GET /store/domains`'s `dnsTarget`: exactly what the runtime's DNS verifier accepts — a
 * CNAME to `cname` or an A record to one of `ipv4`. `null` / empty when not configured.
 */
export interface DnsTargetDto {
  readonly cname: string | null;
  readonly ipv4: readonly string[];
}

/** The target an older runtime (no `dnsTarget` in the reply) is read as: nothing configured. */
export const NO_DNS_TARGET: DnsTargetDto = { cname: null, ipv4: [] };

export function isDnsTargetDto(value: unknown): value is DnsTargetDto {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const ipv4 = candidate["ipv4"];
  return (
    (candidate["cname"] === null || typeof candidate["cname"] === "string") &&
    Array.isArray(ipv4) &&
    ipv4.every((ip) => typeof ip === "string")
  );
}

/**
 * Second-level labels registries sell names under (`example.com.eg`, `example.co.uk`). A three-label
 * host ending in one of these plus a two-letter country code may be an apex OR a subdomain.
 */
const COUNTRY_SECOND_LEVELS: readonly string[] = ["com", "co", "net", "org", "gov", "edu", "ac"];

/**
 * Whether a hostname is a subdomain (`shop.example.com` — CNAME), an apex (`example.com` — A
 * record), or could be either (`example.com.eg`, or anything odd) — then both records are shown.
 */
export function dnsHostKind(hostname: string): "subdomain" | "apex" | "unsure" {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length === 2) return "apex";
  if (labels.length < 2) return "unsure";
  if (labels.length === 3) {
    const [, second, tld] = labels;
    if (tld?.length === 2 && COUNTRY_SECOND_LEVELS.includes(second ?? "")) return "unsure";
  }
  return "subdomain";
}

export type DnsRecordDto =
  | { readonly type: "CNAME"; readonly target: string }
  | { readonly type: "A"; readonly targets: readonly string[] };

/**
 * The DNS record(s) to ask the merchant for, from the verifier's own target. Empty when the record
 * the host needs is not configured — the screen then says to contact support, never a wrong target.
 */
export function dnsRecordsFor(hostname: string, target: DnsTargetDto): readonly DnsRecordDto[] {
  const kind = dnsHostKind(hostname);
  const records: DnsRecordDto[] = [];
  if (kind !== "apex" && target.cname !== null && target.cname !== "") {
    records.push({ type: "CNAME", target: target.cname });
  }
  if (kind !== "subdomain" && target.ipv4.length > 0) {
    records.push({ type: "A", targets: target.ipv4 });
  }
  return records;
}
