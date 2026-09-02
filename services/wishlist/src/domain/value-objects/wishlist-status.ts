import { ValueObject } from "@platform/domain";

export type WishlistStatusValue = "active" | "archived";

/** The validated lifecycle transition table (Sprint 5.1). */
const TRANSITIONS: Readonly<Record<WishlistStatusValue, readonly WishlistStatusValue[]>> = {
  active: ["archived"],
  archived: ["active"],
};

/** Whether a transition from `from` to `to` is allowed by the wishlist lifecycle's transition table. */
export function canTransitionWishlist(from: WishlistStatusValue, to: WishlistStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

interface WishlistStatusProps {
  readonly value: WishlistStatusValue;
}

/** The lifecycle state of a wishlist (active/archived). */
export class WishlistStatus extends ValueObject<WishlistStatusProps> {
  static active(): WishlistStatus {
    return new WishlistStatus({ value: "active" });
  }

  /** Rehydrates a persisted status value (infrastructure trusts stored data; G-12). */
  static from(value: WishlistStatusValue): WishlistStatus {
    return new WishlistStatus({ value });
  }

  get value(): WishlistStatusValue {
    return this.props.value;
  }
}
