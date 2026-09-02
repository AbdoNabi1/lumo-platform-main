import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { WishlistTransitioned } from "./events/wishlist-transitioned.event";
import { WishlistItem } from "./value-objects/wishlist-item";
import {
  canTransitionWishlist,
  WishlistStatus,
  type WishlistStatusValue,
} from "./value-objects/wishlist-status";

interface WishlistProps {
  readonly customerRef: string;
  status: WishlistStatus;
  items: WishlistItem[];
}

/**
 * Source of truth for a customer's favorited/saved products (Sprint 5.1). Owns **no product data**
 * — items are bare refs only. Never mutates the cart directly — `moveToCart` only removes the item
 * here; the actual cart mutation happens through `CartPort`, driven by the application layer.
 */
export class Wishlist extends AggregateRoot<WishlistProps> {
  static create(id: UniqueEntityId, customerRef: string): Wishlist {
    return new Wishlist({ customerRef, status: WishlistStatus.active(), items: [] }, id);
  }

  /** Rebuilds a persisted wishlist exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    customerRef: string,
    status: WishlistStatus,
    version: number,
    items: readonly WishlistItem[] = [],
  ): Wishlist {
    return new Wishlist({ customerRef, status, items: [...items] }, id, version);
  }

  /** The generic, validated status transition — `archive`/`reactivate` delegate to this. */
  transition(toStatus: WishlistStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionWishlist(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition wishlist from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = WishlistStatus.from(toStatus);
    const action = toStatus === "active" ? "reactivated" : "archived";
    this.raise("wishlist", action, eventId, occurredAt);
  }

  archive(eventId: string, occurredAt: Date): void {
    this.transition("archived", eventId, occurredAt);
  }

  reactivate(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt);
  }

  /** Adds a product — idempotent (adding an already-present product is a silent no-op). */
  addItem(productRef: string, occurredAt: Date, eventId: string): void {
    this.requireActive();
    if (this.findItem(productRef) !== undefined) return;
    this.props.items.push(WishlistItem.create(productRef, occurredAt));
    this.raise("item", "added", eventId, occurredAt, productRef);
  }

  /** Removes a product — idempotent (removing an absent product is a silent no-op). */
  removeItem(productRef: string, occurredAt: Date, eventId: string): void {
    this.requireActive();
    if (this.findItem(productRef) === undefined) return;
    this.props.items = this.props.items.filter((item) => item.productRef !== productRef);
    this.raise("item", "removed", eventId, occurredAt, productRef);
  }

  /** Generates (or replays) a share token for one item — idempotent, always returns the item's current token. */
  shareItem(productRef: string, token: string, occurredAt: Date, eventId: string): string {
    this.requireActive();
    const item = this.findItem(productRef);
    if (item === undefined) {
      throw new BusinessRuleError(`Wishlist has no item for product "${productRef}"`);
    }
    if (item.shareToken !== undefined) return item.shareToken;
    this.props.items = this.props.items.map((existing) =>
      existing.productRef === productRef ? existing.withShareToken(token) : existing,
    );
    this.raise("item", "shared", eventId, occurredAt, productRef);
    return token;
  }

  /**
   * Removes a product from the wishlist as the final step of moving it to the cart. The actual cart
   * mutation is the application layer's responsibility (via `CartPort`) — this method only records
   * that the move happened and drops the item from this list.
   */
  moveToCart(productRef: string, occurredAt: Date, eventId: string): void {
    this.requireActive();
    if (this.findItem(productRef) === undefined) {
      throw new BusinessRuleError(`Wishlist has no item for product "${productRef}"`);
    }
    this.props.items = this.props.items.filter((item) => item.productRef !== productRef);
    this.raise("item", "moved_to_cart", eventId, occurredAt, productRef);
  }

  private findItem(productRef: string): WishlistItem | undefined {
    return this.props.items.find((item) => item.productRef === productRef);
  }

  private raise(
    family: "wishlist" | "item",
    action: string,
    eventId: string,
    occurredAt: Date,
    productRef?: string,
  ): void {
    this.addDomainEvent(
      new WishlistTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          customerRef: this.props.customerRef,
          family,
          action,
          productRef,
        },
      ),
    );
  }

  private requireActive(): void {
    if (this.props.status.value !== "active") {
      throw new BusinessRuleError(`Wishlist is not active (status: ${this.props.status.value})`);
    }
  }

  get customerRef(): string {
    return this.props.customerRef;
  }

  get status(): WishlistStatus {
    return this.props.status;
  }

  get items(): readonly WishlistItem[] {
    return this.props.items;
  }
}
