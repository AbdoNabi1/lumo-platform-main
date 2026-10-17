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
