const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A random lowercase token from the platform CSPRNG (server actions run on Node 20+). */
export function randomToken(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return out;
}

/**
 * Shopify-style handle from a title: Latin letters and digits, lowercase, joined by "-". The
 * Catalog `Slug` accepts only `[a-z0-9-]`, so a title with no Latin characters (Arabic) yields ""
 * and the caller uses {@link fallbackHandle}. Arabic handles are Plan 2D.
 */
export function handleFromTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export function fallbackHandle(): string {
  return `product-${randomToken(6)}`;
}

/** The product-level SKU the domain still requires (G-98); merchants never type it. */
export function generateProductSku(): string {
  return `P-${randomToken(6).toUpperCase()}`;
}

function skuPart(value: string, index: number): string {
  const ascii = handleFromTitle(value).toUpperCase();
  return ascii.length > 0 ? ascii : `V${index + 1}`;
}

/** `<productSku>-<VALUE>-<VALUE>`, suffixed -2, -3… until it is not in `taken`. */
export function variantSkuFor(
  productSku: string,
  values: readonly string[],
  taken: ReadonlySet<string>,
): string {
  const base = [productSku, ...values.map(skuPart)].join("-");
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
