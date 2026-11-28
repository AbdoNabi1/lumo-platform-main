/**
 * The catalog id of one order line (P2-D4): the variant when the line has one, else the product.
 *
 * Exported because the P3 browser pixels MUST send the same id, or the ad platform sees two unrelated catalogs and
 * cannot match a browser ViewContent to a server Purchase.
 */
export function contentIdOf(line: {
  readonly productRef: string;
  readonly variantRef?: string | null | undefined;
}): string {
  const variant = line.variantRef?.trim();
  return variant !== undefined && variant !== "" ? variant : line.productRef;
}
