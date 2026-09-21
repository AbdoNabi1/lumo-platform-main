import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { CheckoutCompleted } from "./events/checkout-completed.event";
import { CheckoutExpired } from "./events/checkout-expired.event";
import { CheckoutFailed } from "./events/checkout-failed.event";
import { CheckoutLocked } from "./events/checkout-locked.event";
import { CheckoutRecalculated } from "./events/checkout-recalculated.event";
import type { CheckoutAddress } from "./value-objects/checkout-address";
import type { ContactEmail } from "./value-objects/contact-email";
import { CheckoutState } from "./value-objects/checkout-state";
import type { CheckoutItem } from "./value-objects/checkout-item";
import { CheckoutTotals } from "./value-objects/checkout-totals";
import type { PaymentSelection, ShippingSelection } from "./value-objects/selections";

export interface OrderDraft {
  readonly cartRef: string;
  readonly customerRef?: string;
  readonly items: readonly CheckoutItem[];
  readonly billingAddress: CheckoutAddress;
  readonly shippingAddress: CheckoutAddress;
  readonly totals: CheckoutTotals;
}

export interface PaymentIntentRequest {
  readonly customerRef?: string;
  readonly paymentMethodRef: string;
  readonly provider: string;
  readonly amountMinor: number;
  readonly currency: string;
}

interface CheckoutSessionProps {
  readonly cartRef: string;
  customerRef?: string;
  readonly sessionRef: string;
  readonly currency: string;
  state: CheckoutState;
  orderRef: string | null;
  items: readonly CheckoutItem[];
  billingAddress?: CheckoutAddress;
  shippingAddress?: CheckoutAddress;
  /** Where a guest's receipt goes; Identity resolves a guest customer from it (WP-1, G-52). Absent on sessions created before it existed. */
  contactEmail?: ContactEmail;
  shippingSelection?: ShippingSelection;
  paymentSelection?: PaymentSelection;
  taxMinor?: number;
  discountMinor?: number;
  totals?: CheckoutTotals;
}

/**
 * Fronts the purchase saga: a session opened for a cart that assembles item/address/shipping/
 * payment/tax/promotion **snapshots** (requested from their owning contexts via outbound ports,
 * never computed here) into totals, then ends `completed` (an order was placed + paid) or `failed`
 * (a step failed + compensated). The cross-context orchestration itself (Pricing → Inventory →
 * Payments → Orders, with compensation) is the Temporal `PurchaseWorkflow`'s job (ADR-0012) — this
 * aggregate owns only the session state + snapshot assembly + outcome events. Cart/Order/Payment/
 * Customer are referenced by bare id; no context is imported.
 */
export class CheckoutSession extends AggregateRoot<CheckoutSessionProps> {
  static start(
    id: UniqueEntityId,
    cartRef: string,
    customerRef: string | undefined,
    sessionRef: string,
    currency: string,
  ): CheckoutSession {
    return new CheckoutSession(
      {
        cartRef,
        customerRef,
        sessionRef,
        currency,
        state: CheckoutState.started(),
        orderRef: null,
        items: [],
      },
      id,
    );
  }

  /**
   * Rebuilds a persisted session exactly as stored — no domain events raised, persisted
   * `version` carried for optimistic locking (ADR-0003, G-12).
   */
  static reconstitute(
    id: UniqueEntityId,
    cartRef: string,
    customerRef: string | undefined,
    sessionRef: string,
    currency: string,
    state: CheckoutState,
    orderRef: string | null,
    items: readonly CheckoutItem[],
    version: number,
    extra: {
      readonly billingAddress?: CheckoutAddress;
      readonly shippingAddress?: CheckoutAddress;
      readonly contactEmail?: ContactEmail;
      readonly shippingSelection?: ShippingSelection;
      readonly paymentSelection?: PaymentSelection;
      readonly taxMinor?: number;
      readonly discountMinor?: number;
      readonly totals?: CheckoutTotals;
    } = {},
  ): CheckoutSession {
    return new CheckoutSession(
      {
        cartRef,
        customerRef,
        sessionRef,
        currency,
        state,
        orderRef,
        items: [...items],
        billingAddress: extra.billingAddress,
        shippingAddress: extra.shippingAddress,
        contactEmail: extra.contactEmail,
        shippingSelection: extra.shippingSelection,
        paymentSelection: extra.paymentSelection,
        taxMinor: extra.taxMinor,
        discountMinor: extra.discountMinor,
        totals: extra.totals,
      },
      id,
      version,
    );
  }

  loadItems(items: readonly CheckoutItem[]): void {
    this.ensureOpen();
    this.props.items = items;
  }

  setBillingAddress(address: CheckoutAddress): void {
    this.ensureOpen();
    this.props.billingAddress = address;
  }

  setShippingAddress(address: CheckoutAddress): void {
    this.ensureOpen();
    this.props.shippingAddress = address;
  }

  setContactEmail(email: ContactEmail): void {
    this.ensureOpen();
    this.props.contactEmail = email;
  }

  selectShipping(selection: ShippingSelection): void {
    this.ensureOpen();
    this.props.shippingSelection = selection;
  }

  selectPayment(selection: PaymentSelection): void {
    this.ensureOpen();
    this.props.paymentSelection = selection;
  }

  /** Stores the tax snapshot requested from Finance via `TaxCalculationPort` — never computed here. */
  applyTaxSnapshot(taxMinor: number): void {
    this.ensureOpen();
    this.props.taxMinor = taxMinor;
  }

  /** Stores the discount snapshot requested from Promotions via `PromotionValidationPort` — never computed here. */
  applyPromotionSnapshot(discountMinor: number): void {
    this.ensureOpen();
    this.props.discountMinor = discountMinor;
  }

  /** Assembles `CheckoutTotals` as a sum of the stored snapshots. Emits `checkout_session.recalculated`. */
  recalculateTotals(eventId: string, occurredAt: Date): void {
    this.ensureOpen();
    if (this.props.items.length === 0) {
      throw new BusinessRuleError("Cannot recalculate totals for an empty checkout");
    }
    const totals = CheckoutTotals.assemble(
      this.props.items,
      this.props.taxMinor ?? 0,
      this.props.shippingSelection?.rateAmountMinor ?? 0,
      this.props.discountMinor ?? 0,
      this.props.currency,
    );
    this.props.totals = totals;
    this.addDomainEvent(
      new CheckoutRecalculated(
        { eventId, aggregateId: this.id, occurredAt },
        {
          cartRef: this.props.cartRef,
          subtotalMinor: totals.subtotalMinor,
          taxMinor: totals.taxMinor,
          shippingMinor: totals.shippingMinor,
          discountMinor: totals.discountMinor,
          totalMinor: totals.totalMinor,
          currency: totals.currency,
        },
      ),
    );
  }

  /** Locks the session against further detail changes while the purchase saga runs. Emits `checkout_session.locked`. */
  lock(eventId: string, occurredAt: Date): void {
    if (!this.props.state.isStarted) {
      throw new BusinessRuleError(
        `Checkout session is ${this.props.state.value} and cannot be locked`,
      );
    }
    this.props.state = CheckoutState.locked();
    this.addDomainEvent(
      new CheckoutLocked(
        { eventId, aggregateId: this.id, occurredAt },
        { cartRef: this.props.cartRef, customerRef: this.props.customerRef },
      ),
    );
  }

  /** Expires a still-open session (started/locked). Emits `checkout_session.expired`. */
  expire(eventId: string, occurredAt: Date): void {
    this.ensureOpen();
    this.props.state = CheckoutState.expired();
    this.addDomainEvent(
      new CheckoutExpired(
        { eventId, aggregateId: this.id, occurredAt },
        { cartRef: this.props.cartRef, customerRef: this.props.customerRef },
      ),
    );
  }

  complete(orderRef: string, eventId: string, occurredAt: Date): void {
    this.ensureOpen();
    this.props.state = CheckoutState.completed();
    this.props.orderRef = orderRef;
    this.addDomainEvent(
      new CheckoutCompleted(
        { eventId, aggregateId: this.id, occurredAt },
        { cartRef: this.props.cartRef, customerRef: this.props.customerRef ?? "", orderRef },
      ),
    );
  }

  fail(reason: string, eventId: string, occurredAt: Date): void {
    this.ensureOpen();
    this.props.state = CheckoutState.failed();
    this.addDomainEvent(
      new CheckoutFailed(
        { eventId, aggregateId: this.id, occurredAt },
        { cartRef: this.props.cartRef, customerRef: this.props.customerRef ?? "", reason },
      ),
    );
  }

  /** Assembles the pure snapshot DTO handed to Orders — Checkout never creates the order itself. */
  generateOrderDraft(): OrderDraft {
    if (this.props.items.length === 0) {
      throw new BusinessRuleError("Cannot generate an order draft with no items");
    }
    if (this.props.billingAddress === undefined || this.props.shippingAddress === undefined) {
      throw new BusinessRuleError("Cannot generate an order draft without both addresses");
    }
    if (this.props.totals === undefined) {
      throw new BusinessRuleError("Cannot generate an order draft before totals are calculated");
    }
    return {
      cartRef: this.props.cartRef,
      customerRef: this.props.customerRef,
      items: this.props.items,
      billingAddress: this.props.billingAddress,
      shippingAddress: this.props.shippingAddress,
      totals: this.props.totals,
    };
  }

  /** Assembles the pure snapshot DTO handed to Payments — Checkout never captures payment itself. */
  generatePaymentIntentRequest(): PaymentIntentRequest {
    if (this.props.paymentSelection === undefined) {
      throw new BusinessRuleError(
        "Cannot generate a payment intent request without a payment selection",
      );
    }
    if (this.props.totals === undefined) {
      throw new BusinessRuleError(
        "Cannot generate a payment intent request before totals are calculated",
      );
    }
    return {
      customerRef: this.props.customerRef,
      paymentMethodRef: this.props.paymentSelection.paymentMethodRef,
      provider: this.props.paymentSelection.provider,
      amountMinor: this.props.totals.totalMinor,
      currency: this.props.totals.currency,
    };
  }

  get cartRef(): string {
    return this.props.cartRef;
  }

  get customerRef(): string | undefined {
    return this.props.customerRef;
  }

  get sessionRef(): string {
    return this.props.sessionRef;
  }

  get currency(): string {
    return this.props.currency;
  }

  get isGuest(): boolean {
    return this.props.customerRef === undefined;
  }

  get state(): CheckoutState {
    return this.props.state;
  }

  get orderRef(): string | null {
    return this.props.orderRef;
  }

  get items(): readonly CheckoutItem[] {
    return this.props.items;
  }

  get billingAddress(): CheckoutAddress | undefined {
    return this.props.billingAddress;
  }

  get shippingAddress(): CheckoutAddress | undefined {
    return this.props.shippingAddress;
  }

  get contactEmail(): ContactEmail | undefined {
    return this.props.contactEmail;
  }

  get shippingSelection(): ShippingSelection | undefined {
    return this.props.shippingSelection;
  }

  get paymentSelection(): PaymentSelection | undefined {
    return this.props.paymentSelection;
  }

  get taxMinor(): number | undefined {
    return this.props.taxMinor;
  }

  get discountMinor(): number | undefined {
    return this.props.discountMinor;
  }

  get totals(): CheckoutTotals | undefined {
    return this.props.totals;
  }

  private ensureOpen(): void {
    if (!this.props.state.isOpen) {
      throw new BusinessRuleError(
        `Checkout session is ${this.props.state.value} and can no longer be modified`,
      );
    }
  }
}
