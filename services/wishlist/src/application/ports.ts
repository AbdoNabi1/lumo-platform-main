/** Outbound seam to Cart — Wishlist never mutates the cart directly, only through this port. */
export interface CartPort {
  addItem(customerRef: string, productRef: string): Promise<void>;
}
