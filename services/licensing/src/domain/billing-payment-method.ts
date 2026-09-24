import { BusinessRuleError } from "@platform/domain";

/** The provider key stored methods are recorded under: Morbeh's own billing account, not a merchant's. */
export const BILLING_PROVIDER = "paymob";

export type BillingPaymentMethodStatus = "pending" | "active" | "revoked";

export interface BillingPaymentMethodState {
  readonly id: string;
  /** The MERCHANT being billed — the payer. The owner of the row is the platform, never this tenant. */
  readonly tenantRef: string;
  readonly provider: string;
  /** The PSP's order id of the interactive first payment: how its token callback is correlated to a merchant. */
  readonly providerOrderId: string;
  readonly status: BillingPaymentMethodStatus;
  /** The PSP's id for the stored card (stable across redeliveries of its callback). */
  readonly tokenId?: string;
  /** The card token, SEALED (`BillingTokenSealer`). Never plaintext; never leaves this record except via `sealedTokenForCharge`. */
  readonly sealedToken?: string;
  readonly maskedPan?: string;
  readonly cardSubtype?: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The saved card Morbeh charges to renew a merchant's subscription (WP-14 follow-up G-74 (1)).
 *
 * This is MORBEH's record about a customer of the platform. It is scoped to the platform tenant like
 * `Subscription`/`Invoice`, never to the merchant's own tenant: a merchant who could read, edit or
 * delete the token that bills them would control whether they get billed.
 *
 * The token is a secret that charges the card. It is held only sealed, and this class deliberately
 * has no accessor that returns anything usable to a serialiser: `toJSON` and `toString` expose the
 * display fields only, and the sealed blob leaves through exactly two named doors —
 * `sealedTokenForCharge` (to be opened for one charge) and `toPersistence` (to the repository).
 *
 * `pending` (checkout started, no token yet) → `active` (token received and sealed) → `revoked`.
 * At most one method per merchant is `active`; the use case revokes the previous one on activation.
 */
export class BillingPaymentMethod {
  private state: BillingPaymentMethodState;

  private constructor(state: BillingPaymentMethodState) {
    this.state = state;
  }

  static begin(
    id: string,
    tenantRef: string,
    provider: string,
    providerOrderId: string,
    now: Date,
  ): BillingPaymentMethod {
    return new BillingPaymentMethod({
      id,
      tenantRef,
      provider,
      providerOrderId,
      status: "pending",
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(state: BillingPaymentMethodState): BillingPaymentMethod {
    return new BillingPaymentMethod(state);
  }

  get id(): string {
    return this.state.id;
  }
  get tenantRef(): string {
    return this.state.tenantRef;
  }
  get provider(): string {
    return this.state.provider;
  }
  get providerOrderId(): string {
    return this.state.providerOrderId;
  }
  get status(): BillingPaymentMethodStatus {
    return this.state.status;
  }
  get tokenId(): string | undefined {
    return this.state.tokenId;
  }
  get maskedPan(): string | undefined {
    return this.state.maskedPan;
  }
  get cardSubtype(): string | undefined {
    return this.state.cardSubtype;
  }
  get version(): number {
    return this.state.version;
  }

  /** `pending → active`. The token arrives already sealed: this record never sees plaintext. */
  activate(
    card: {
      readonly tokenId: string;
      readonly sealedToken: string;
      readonly maskedPan: string;
      readonly cardSubtype: string;
    },
    now: Date,
  ): void {
    if (this.state.status !== "pending") {
      throw new BusinessRuleError(`Cannot activate a ${this.state.status} payment method`);
    }
    this.state = { ...this.state, ...card, status: "active", updatedAt: now };
  }

  /** `active → revoked` (or `pending → revoked`). Idempotent on an already-revoked method. */
  revoke(now: Date): void {
    if (this.state.status === "revoked") return;
    this.state = { ...this.state, status: "revoked", updatedAt: now };
  }

  /** The sealed token, for the one place that opens it to charge. Throws if this method holds none. */
  sealedTokenForCharge(): string {
    if (this.state.status !== "active" || this.state.sealedToken === undefined) {
      throw new BusinessRuleError("This payment method holds no usable token");
    }
    return this.state.sealedToken;
  }

  /** The whole state, for the repository ONLY (it writes the sealed column). Not for serialisers or DTOs. */
  toPersistence(): BillingPaymentMethodState {
    return this.state;
  }

  /** Display fields only: what may be shown to a platform operator. */
  toJSON(): Record<string, unknown> {
    return {
      id: this.state.id,
      tenantRef: this.state.tenantRef,
      provider: this.state.provider,
      status: this.state.status,
      maskedPan: this.state.maskedPan,
      cardSubtype: this.state.cardSubtype,
    };
  }

  toString(): string {
    return `BillingPaymentMethod(${this.state.id}, ${this.state.status})`;
  }

  /** `console.log`/`util.inspect` would otherwise print the private state, sealed blob included. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}
