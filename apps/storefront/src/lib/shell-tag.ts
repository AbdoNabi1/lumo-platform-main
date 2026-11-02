/** The cache tag of one shop's storefront shell. The reader and the revalidate route share it. */
export const shellTag = (shopId: string): string => `os:${shopId}`;
