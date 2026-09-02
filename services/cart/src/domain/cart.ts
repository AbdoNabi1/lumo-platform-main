import {
  AggregateRoot,
  BusinessRuleError,
  isValidCurrencyCode,
  Money,
  type ProductRef,
  type UniqueEntityId,
} from "@platform/domain";
import { CartItem, type CartItemSnapshots } from "./cart-item";
import { CartAbandoned } from "./events/cart-abandoned.event";
import { CartCheckedOut } from "./events/cart-checked-out.event";
import { CartExpired } from "./events/cart-expired.event";
import { CartLocked } from "./events/cart-locked.event";
import { CartMerged } from "./events/cart-merged.event";
import { CartSaved } from "./events/cart-saved.event";
import type { Quantity } from "./value-objects/quantity";

export type CartStatus = "active" | "checked_out" | "abandoned" | "locked" | "saved" | "expired";

interface CartProps {
  /** Undefined for a guest cart (Sprint 4.5) — `sessionRef` is always present, customer/guest alike. */
  customerRef?: string;
  readonly sessionRef: string;
  readonly currency: string;
  status: CartStatus;
  readonly items: CartItem[];
}

/**
 * A customer's (or guest's) live cart. Holds lines (each with a unit-price snapshot), enforces a
 * single currency, and raises `cart.checked_out` / `cart.abandoned` / `cart.merged` / `cart.locked` /
 * `cart.saved` / `cart.expired` on lifecycle transitions. Pricing/Inventory are never imported:
 * products are referenced by id and the unit price/availability are supplied by the caller.
 */
export class Cart extends AggregateRoot<CartProps> {
  static create(
    id: UniqueEntityId,
    customerRef: string | undefined,
    sessionRef: string,
    currency: string,
  ): Cart {
    if (!isValidCurrencyCode(currency)) {
      throw new BusinessRuleError(`Invalid cart currency "${currency}"`);
    }
    return new Cart({ customerRef, sessionRef, currency, status: "active", items: [] }, id);
  }

  /**
   * Rebuilds a persisted cart exactly as stored — no domain events raised, persisted `version`
   * carried for optimistic locking (ADR-0003, G-12).
   */
  static reconstitute(
    id: UniqueEntityId,
    customerRef: string | undefined,
    sessionRef: string,
    currency: string,
    status: CartStatus,
    items: readonly CartItem[],
    version: number,
  ): Cart {
    return new Cart({ customerRef, sessionRef, currency, status, items: [...items] }, id, version);
  }

  addItem(
    itemId: UniqueEntityId,
    productRef: ProductRef,
    quantity: Quantity,
    unitPrice: Money,
    snapshots: CartItemSnapshots = {},
  ): void {
    this.ensureActive();
    if (unitPrice.currency !== this.props.currency) {
      throw new BusinessRuleError("Item currency does not match the cart currency");
    }
    const existing = this.props.items.find((i) => i.productRef.value === productRef.value);
    if (existing !== undefined) {
      existing.increaseBy(quantity);
      return;
    }
    this.props.items.push(CartItem.create(itemId, productRef, quantity, unitPrice, snapshots));
  }

  removeItem(productId: string): void {
    this.ensureActive();
    const item = this.props.items.find((i) => i.productRef.value === productId);
    if (item === undefined) {
      throw new BusinessRuleError("Item not found in cart");
    }
    this.props.items.splice(this.props.items.indexOf(item), 1);
  }

  changeItemQuantity(productId: string, quantity: Quantity): void {
    this.ensureActive();
    const item = this.props.items.find((i) => i.productRef.value === productId);
    if (item === undefined) {
      throw new BusinessRuleError("Item not found in cart");
    }
    item.changeQuantityTo(quantity);
  }

  /** Replaces a line's product (e.g. a different variant), carrying a fresh price/quantity snapshot. */
  replaceItemVariant(
    itemId: UniqueEntityId,
    oldProductId: string,
    newProductRef: ProductRef,
    quantity: Quantity,
    unitPrice: Money,
    snapshots: CartItemSnapshots = {},
  ): void {
    this.ensureActive();
    if (unitPrice.currency !== this.props.currency) {
      throw new BusinessRuleError("Item currency does not match the cart currency");
    }
    const index = this.props.items.findIndex((i) => i.productRef.value === oldProductId);
    if (index === -1) {
      throw new BusinessRuleError("Item not found in cart");
    }
    this.props.items.splice(
      index,
      1,
      CartItem.create(itemId, newProductRef, quantity, unitPrice, snapshots),
    );
  }

  clear(): void {
    this.ensureActive();
    this.props.items.splice(0, this.props.items.length);
  }

  /** Assigns a customer to a previously-guest cart. Idempotent-guarded: fails if already assigned. */
  assignCustomer(customerRef: string): void {
    if (this.props.customerRef !== undefined) {
      throw new BusinessRuleError("Cart already has a customer");
    }
    this.props.customerRef = customerRef;
  }

  /** Merges another (typically guest) cart's lines into this one — same-currency only. Emits `cart.merged`. */
  merge(source: Cart, eventId: string, occurredAt: Date): void {
    this.ensureActive();
    if (source.currency !== this.props.currency) {
      throw new BusinessRuleError("Cannot merge carts with different currencies");
    }
    for (const item of source.items) {
      const existing = this.props.items.find((i) => i.productRef.value === item.productRef.value);
      if (existing !== undefined) {
        existing.increaseBy(item.quantity);
      } else {
        this.props.items.push(item);
      }
    }
    this.addDomainEvent(
      new CartMerged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          sourceCartId: source.id.toString(),
          customerRef: this.props.customerRef ?? "",
          lineCount: this.props.items.length,
        },
      ),
    );
  }

  /** Locks the cart against further modification (e.g. while checkout is in progress). Emits `cart.locked`. */
  lock(eventId: string, occurredAt: Date): void {
    this.ensureActive();
    this.props.status = "locked";
    this.addDomainEvent(
      new CartLocked(
        { eventId, aggregateId: this.id, occurredAt },
        { customerRef: this.props.customerRef },
      ),
    );
  }

  /** Plain transition back to active — no dedicated integration event (none named in any sprint report). */
  unlock(): void {
    if (this.props.status !== "locked") {
      throw new BusinessRuleError("Cart is not locked");
    }
    this.props.status = "active";
  }

  /** Sets an active cart aside ("save for later"). Emits `cart.saved`. */
  saveForLater(eventId: string, occurredAt: Date): void {
    this.ensureActive();
    this.props.status = "saved";
    this.addDomainEvent(
      new CartSaved(
        { eventId, aggregateId: this.id, occurredAt },
        { customerRef: this.props.customerRef, lineCount: this.props.items.length },
      ),
    );
  }

  /** Plain transition back to active — no dedicated integration event (none named in any sprint report). */
  restore(): void {
    if (this.props.status !== "saved") {
      throw new BusinessRuleError("Cart is not saved");
    }
    this.props.status = "active";
  }

  /** Expires a still-live cart (active/locked/saved). Emits `cart.expired`. */
  expire(eventId: string, occurredAt: Date): void {
    if (
      this.props.status === "checked_out" ||
      this.props.status === "abandoned" ||
      this.props.status === "expired"
    ) {
      throw new BusinessRuleError(`Cart is ${this.props.status} and cannot expire`);
    }
    const previousStatus = this.props.status;
    this.props.status = "expired";
    this.addDomainEvent(
      new CartExpired(
        { eventId, aggregateId: this.id, occurredAt },
        { customerRef: this.props.customerRef, previousStatus },
      ),
    );
  }

  checkOut(eventId: string, occurredAt: Date): void {
    this.ensureActive();
    if (this.props.items.length === 0) {
      throw new BusinessRuleError("Cannot check out an empty cart");
    }
    this.props.status = "checked_out";
    const total = this.totalAmount();
    this.addDomainEvent(
      new CartCheckedOut(
        { eventId, aggregateId: this.id, occurredAt },
        {
          customerRef: this.props.customerRef ?? "",
          currency: this.props.currency,
          totalAmountMinor: total.amountMinor,
          lineCount: this.props.items.length,
        },
      ),
    );
  }

  abandon(eventId: string, occurredAt: Date): void {
    this.ensureActive();
    this.props.status = "abandoned";
    this.addDomainEvent(
      new CartAbandoned(
        { eventId, aggregateId: this.id, occurredAt },
        { customerRef: this.props.customerRef ?? "", lineCount: this.props.items.length },
      ),
    );
  }

  totalAmount(): Money {
    return this.props.items.reduce(
      (acc, item) => acc.plus(item.lineTotal),
      Money.zero(this.props.currency),
    );
  }

  get customerRef(): string | undefined {
    return this.props.customerRef;
  }

  get sessionRef(): string {
    return this.props.sessionRef;
  }

  get isGuest(): boolean {
    return this.props.customerRef === undefined;
  }

  get currency(): string {
    return this.props.currency;
  }

  get status(): CartStatus {
    return this.props.status;
  }

  get items(): readonly CartItem[] {
    return this.props.items;
  }

  private ensureActive(): void {
    if (this.props.status !== "active") {
      throw new BusinessRuleError(`Cart is ${this.props.status} and can no longer be modified`);
    }
  }
}
