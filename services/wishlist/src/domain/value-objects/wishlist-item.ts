import { ValueObject } from "@platform/domain";

interface WishlistItemProps {
  readonly productRef: string;
  readonly addedAt: Date;
  readonly shareToken?: string;
}

/** One favorited/saved product — a bare reference only (Wishlist owns no product data). */
export class WishlistItem extends ValueObject<WishlistItemProps> {
  static create(productRef: string, addedAt: Date, shareToken?: string): WishlistItem {
    return new WishlistItem({ productRef, addedAt, shareToken });
  }

  withShareToken(shareToken: string): WishlistItem {
    return new WishlistItem({ ...this.props, shareToken });
  }

  get productRef(): string {
    return this.props.productRef;
  }

  get addedAt(): Date {
    return this.props.addedAt;
  }

  get shareToken(): string | undefined {
    return this.props.shareToken;
  }
}
