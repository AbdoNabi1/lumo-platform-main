/**
 * Project 1: a store's URL slug from its name — ASCII lower-case letters, digits and single hyphens
 * (TenantSlug's rule). Names with no Latin letters or digits (Arabic names) get `store-<random>`;
 * the merchant can connect their own domain later. Uniqueness is the caller's job (suffix -2, -3…).
 */
export function deriveSlugBase(storeName: string, random: () => string): string {
  const ascii = storeName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const capped = ascii.slice(0, 40).replace(/-+$/g, "");
  return capped === "" ? `store-${random()}` : capped;
}

/** Six lower-case base-36 characters. */
export function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}
