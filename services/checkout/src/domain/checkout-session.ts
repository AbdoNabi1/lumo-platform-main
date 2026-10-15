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
import {
  DISCOUNT_ATTEMPT_LIMIT,
  DISCOUNT_ATTEMPT_WINDOW_MS,
  MAX_DISCOUNT_CODES,
  normalizeDiscountCode,
  type AppliedDiscountSnapshot,
  type DiscountSnapshot,
} from "./value-objects/discount-snapshot";
import type { PaymentSelection, ShippingSelection } from "./value-objects/selections";

export interface OrderDraft {
  readonly cartRef: string;
  readonly customerRef?: string;
  /** The guest's receipt address, when set — what Identity resolves a guest customer from. */
  readonly contactEmail?: string;
  readonly items: readonly CheckoutItem[];
  readonly billingAddress: CheckoutAddress;
  readonly shippingAddress: CheckoutAddress;
  readonly totals: CheckoutTotals;
  /** The shipping method the shopper selected (e.g. "standard"); Orders snapshots it with the totals. */
  readonly shippingMethod?: string;
  /** Phase 2: the discounts the order is placed with (empty when none). */
  readonly discounts: readonly AppliedDiscountSnapshot[];
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
  /** The payment intent opened for this session's order once the shopper paid/committed (WP-13). Set once. */
  paymentIntentRef?: string;
  taxMinor?: number;
  /** Plan 3C: whether `taxMinor` is already inside the prices. Persisted through the totals snapshot. */
  taxIncluded?: boolean;
  discountMinor?: number;
  totals?: CheckoutTotals;
  /** Phase 2: the codes the shopper entered, normalised, at most five. */
  discountCodes: readonly string[];
  /** Phase 2: the last decision Promotions made for this session. */
  discountSnapshot?: DiscountSnapshot;
  rejectedCodeAttempts: number;
  codeAttemptsWindowStartedAt?: Date;
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
        discountCodes: [],
        rejectedCodeAttempts: 0,
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
      readonly paymentIntentRef?: string;
      readonly taxMinor?: number;
      readonly taxIncluded?: boolean;
      readonly discountMinor?: number;
      readonly totals?: CheckoutTotals;
      readonly discountCodes?: readonly string[];
      readonly discountSnapshot?: DiscountSnapshot;
      readonly rejectedCodeAttempts?: number;
      readonly codeAttemptsWindowStartedAt?: Date;
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
        paymentIntentRef: extra.paymentIntentRef,
        taxMinor: extra.taxMinor,
        taxIncluded: extra.taxIncluded,
        discountMinor: extra.discountMinor,
        totals: extra.totals,
        discountCodes: [...(extra.discountCodes ?? [])],
        discountSnapshot: extra.discountSnapshot,
        rejectedCodeAttempts: extra.rejectedCodeAttempts ?? 0,
        codeAttemptsWindowStartedAt: extra.codeAttemptsWindowStartedAt,
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

  /**
   * Records the payment intent opened for this session's order (WP-13). Deliberately NOT gated by
   * `ensureOpen`: payment is initiated AFTER `complete()` has created the order, when the session
   * is no longer open. Requires the order to exist and the shopper's method to have been chosen —
   * the intent is opened for exactly what they selected, never a default — and is set at most once,
   * so a repeat initiation resumes the same intent instead of opening a second charge.
   */
  attachPaymentIntent(paymentIntentRef: string): void {
    if (this.props.orderRef === null) {
      throw new BusinessRuleError("Payment can only be initiated for a completed checkout");
    }
    if (this.props.paymentSelection === undefined) {
      throw new BusinessRuleError(
        "Payment cannot be initiated before a payment method is selected",
      );
    }
    if (
      this.props.paymentIntentRef !== undefined &&
      this.props.paymentIntentRef !== paymentIntentRef
    ) {
      throw new BusinessRuleError("This checkout already has a payment intent");
    }
    this.props.paymentIntentRef = paymentIntentRef;
  }

  /**
   * Stores the tax snapshot requested from Finance via `TaxCalculationPort` — never computed here.
   * `included` says whether that tax is already inside the prices (Plan 3C); a caller that does not
   * know keeps the pre-3C meaning: the tax is added to the total.
   */
  applyTaxSnapshot(taxMinor: number, included = false): void {
    this.ensureOpen();
    this.props.taxMinor = taxMinor;
    this.props.taxIncluded = included;
  }

  /** Stores the discount snapshot requested from Promotions via `PromotionValidationPort` — never computed here. */
  applyPromotionSnapshot(discountMinor: number): void {
    this.ensureOpen();
    this.props.discountMinor = discountMinor;
  }

  /** Adds a code the shopper typed (Phase 2). Already entered: nothing changes. A sixth code: refused. */
  enterDiscountCode(code: string): void {
    this.ensureOpen();
    const normalized = normalizeDiscountCode(code);
    if (this.props.discountCodes.includes(normalized)) return;
    if (this.props.discountCodes.length >= MAX_DISCOUNT_CODES) {
      throw new BusinessRuleError(`TOO_MANY_CODES: at most ${MAX_DISCOUNT_CODES} discount codes`);
    }
    this.props.discountCodes = [...this.props.discountCodes, normalized];
  }

  removeDiscountCode(code: string): void {
    this.ensureOpen();
    const normalized = normalizeDiscountCode(code);
    this.props.discountCodes = this.props.discountCodes.filter((c) => c !== normalized);
  }

  /** Stores what Promotions decided (Phase 2); the order discount becomes `discountMinor`. Never computed here. */
  applyDiscountSnapshot(snapshot: DiscountSnapshot): void {
    this.ensureOpen();
    this.props.discountSnapshot = snapshot;
    this.props.discountMinor = snapshot.orderDiscountMinor;
  }

  /** Counts a rejected code; the count restarts once the window has passed. */
  recordRejectedDiscountCode(now: Date): void {
    this.ensureOpen();
    const start = this.props.codeAttemptsWindowStartedAt;
    if (start === undefined || now.getTime() - start.getTime() >= DISCOUNT_ATTEMPT_WINDOW_MS) {
      this.props.codeAttemptsWindowStartedAt = now;
      this.props.rejectedCodeAttempts = 1;
      return;
    }
    this.props.rejectedCodeAttempts += 1;
  }

  /** True after ten rejected codes within fifteen minutes — guards against guessing codes. */
  isDiscountCodeEntryLocked(now: Date): boolean {
    const start = this.props.codeAttemptsWindowStartedAt;
    return (
      start !== undefined &&
      now.getTime() - start.getTime() < DISCOUNT_ATTEMPT_WINDOW_MS &&
      this.props.rejectedCodeAttempts >= DISCOUNT_ATTEMPT_LIMIT
    );
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
      {
        taxIncluded: this.props.taxIncluded ?? false,
        shippingName: this.props.shippingSelection?.name,
        shippingDiscountMinor: this.props.discountSnapshot?.shippingDiscountMinor ?? 0,
      },
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
      contactEmail: this.props.contactEmail?.value,
      items: this.props.items,
      billingAddress: this.props.billingAddress,
      shippingAddress: this.props.shippingAddress,
      totals: this.props.totals,
      shippingMethod: this.props.shippingSelection?.method,
      discounts: this.props.discountSnapshot?.applied ?? [],
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

  get paymentIntentRef(): string | undefined {
    return this.props.paymentIntentRef;
  }

  get taxMinor(): number | undefined {
    return this.props.taxMinor;
  }

  get taxIncluded(): boolean | undefined {
    return this.props.taxIncluded;
  }

  get discountMinor(): number | undefined {
    return this.props.discountMinor;
  }

  get totals(): CheckoutTotals | undefined {
    return this.props.totals;
  }

  get discountCodes(): readonly string[] {
    return this.props.discountCodes;
  }

  get discountSnapshot(): DiscountSnapshot | undefined {
    return this.props.discountSnapshot;
  }

  get rejectedCodeAttempts(): number {
    return this.props.rejectedCodeAttempts;
  }

  get codeAttemptsWindowStartedAt(): Date | undefined {
    return this.props.codeAttemptsWindowStartedAt;
  }

  /** Whether Phase 2 discounts have touched this session (a legacy `applyPromotionSnapshot` session has not). */
  get hasDiscountState(): boolean {
    return this.props.discountCodes.length > 0 || this.props.discountSnapshot !== undefined;
  }

  private ensureOpen(): void {
    if (!this.props.state.isOpen) {
      throw new BusinessRuleError(
        `Checkout session is ${this.props.state.value} and can no longer be modified`,
      );
    }
  }
}
