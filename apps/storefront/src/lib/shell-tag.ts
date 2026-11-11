/** The cache tag of one shop's storefront shell. The reader and the revalidate route share it. */
export const shellTag = (shopId: string): string => `os:${shopId}`;

/** The cache tag of one shop's catalog data on the homepage (Ruling 15; nothing revalidates it). */
export const catalogTag = (shopId: string): string => `catalog:${shopId}`;

/** How long every per-shop storefront cache entry lives: shell, content, home and section data. */
export const STOREFRONT_CACHE_TTL_SECONDS = 60;
