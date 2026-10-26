import { randomBytes } from "node:crypto";
import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError, NotFoundError } from "@platform/utils";
import { CheckoutLink, INVOICE_LINK_TTL_MS } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import type { CheckoutAddressInput } from "../domain/value-objects/checkout-address";
import { ContactEmail } from "../domain/value-objects/contact-email";
import { draftCartRef } from "../domain/value-objects/draft-terms";
import { PaymentSelection } from "../domain/value-objects/selections";
import { linkInvalid } from "./abandoned-checkouts.use-cases";
import { validCheckoutAddress } from "./address-province";
import { checkoutItemsFrom, type LoadItemsInput } from "./checkout-details.use-cases";
import { calculateAndStoreTax } from "./discount-code.use-cases";
import type {
  ShippingCalculationPort,
  ShippingQuote,
  TaxCalculationPort,
  TaxCalculationResult,
} from "./ports";

/** Spec §4.5: 32 random bytes, base64url — the owner of a draft session nobody holds yet. Never returned. */
export function newDraftSessionRef(): string {
  return randomBytes(32).toString("base64url");
}

function draftCheckoutGone(): BusinessRuleError {
  return new BusinessRuleError("DRAFT_BUSY: this invoice's checkout changed; open the link again");
}

export interface DraftCheckoutDeps {
  readonly sessions: CheckoutSessionRepository;
  readonly links: CheckoutLinkRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly taxCalculation: TaxCalculationPort;
}

export interface StartDraftCheckoutInput {
  readonly tenantId: string;
  readonly draftOrderRef: string;
  readonly draftNumber: string;
  /** The draft's existing customer, or absent for a guest. */
  readonly customerRef?: string;
  readonly currency: string;
  /** The draft's lines at the prices stored at its last save (Ruling 12) — server-side values only. */
  readonly items: LoadItemsInput["items"];
  readonly contactEmail?: string;
  readonly shippingAddress: CheckoutAddressInput;
  readonly billingAddress: CheckoutAddressInput;
  readonly discount?: { readonly title: string; readonly amountMinor: number };
  readonly shipping: { readonly title: string; readonly amountMinor: number };
  /** The draft's previous session: expired here when it is still open AND this draft's. */
  readonly replaces?: string;
}

/**
 * Spec §4.5 step 2 in ONE unit of work: build the new session — server-minted `sessionRef`, `cartRef`
 * naming the draft (Ruling 1), the draft's lines, contact and addresses, the merchant's terms, the tax
 * from Finance and the totals — and only once it is complete, expire the draft's previous session (if
 * open) and save both. Always a FRESH session: a draft that changed is materialised again, never
 * re-loaded into an existing session. Domain refusals (`DRAFT_TOTAL_TOO_LARGE:`, …) are answered as
 * they are, unchanged, and write nothing.
 */
export class StartDraftCheckout implements UseCase<
  StartDraftCheckoutInput,
  { readonly checkoutSessionId: string },
  DomainError
> {
  private readonly deps: DraftCheckoutDeps;

  constructor(deps: DraftCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: StartDraftCheckoutInput,
  ): Promise<Result<{ readonly checkoutSessionId: string }, DomainError>> {
    const currency = Money.create(0, input.currency);
    if (!currency.ok) return err(currency.error);
    const items = checkoutItemsFrom(input.items);
    if (!items.ok) return err(items.error);
    const shipping = validCheckoutAddress(input.shippingAddress);
    if (!shipping.ok) return err(shipping.error);
    const billing = validCheckoutAddress(input.billingAddress);
    if (!billing.ok) return err(billing.error);
    const email =
      input.contactEmail === undefined ? undefined : ContactEmail.create(input.contactEmail);
    if (email !== undefined && !email.ok) return err(email.error);

    return this.deps.unitOfWork.run<Result<{ readonly checkoutSessionId: string }, DomainError>>(
      async (tx) => {
        const now = this.deps.clock.now();
        // The new session is built and checked completely BEFORE anything is written: the unit of
        // work commits on a returned `err` too, so a refusal must leave the replaced session open.
        const id = this.deps.idGenerator.generate();
        const session = CheckoutSession.start(
          UniqueEntityId.from(id),
          draftCartRef(input.draftOrderRef),
          input.customerRef,
          newDraftSessionRef(),
          input.currency,
        );
        try {
          // Items first: the terms check the discount against their subtotal, and lock them after.
          session.loadItems(items.value);
          if (email !== undefined && email.ok) session.setContactEmail(email.value);
          session.setShippingAddress(shipping.value);
          session.setBillingAddress(billing.value);
          session.applyDraftTerms({
            draftOrderRef: input.draftOrderRef,
            draftNumber: input.draftNumber,
            ...(input.discount === undefined ? {} : { discount: input.discount }),
            shipping: input.shipping,
          });
          // The tax is Finance's answer for the fixed terms; the totals are then assembled with it.
          await calculateAndStoreTax(session, this.deps.taxCalculation, input.tenantId);
          session.recalculateTotals(this.deps.idGenerator.generate(), now);
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        // Nothing below refuses: the previous session is expired only once its successor is ready.
        if (input.replaces !== undefined) {
          const old = await this.deps.sessions.findById(input.replaces, input.tenantId, tx);
          if (
            old !== null &&
            old.state.isOpen &&
            old.draftTerms?.draftOrderRef === input.draftOrderRef
          ) {
            old.expire(this.deps.idGenerator.generate(), now);
            await this.deps.sessions.save(old, input.tenantId, tx);
          }
        }
        await this.deps.sessions.save(session, input.tenantId, tx);
        return ok({ checkoutSessionId: id });
      },
    );
  }
}

export interface SelectDraftPaymentInput {
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  /** Collect on delivery → `cod`; Mark as paid → `manual` (spec §4.6 step 1). */
  readonly provider: "cod" | "manual";
}

/**
 * Spec §4.6 step 1: the merchant's own choice, bypassing the shopper-facing "offered" list — refused on
 * any session that is not a draft order's (Ruling 8), so no shopper path can reach `manual`.
 */
export class SelectDraftPayment implements UseCase<
  SelectDraftPaymentInput,
  { readonly checkoutSessionId: string },
  DomainError
> {
  private readonly deps: DraftCheckoutDeps;

  constructor(deps: DraftCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: SelectDraftPaymentInput,
  ): Promise<Result<{ readonly checkoutSessionId: string }, DomainError>> {
    const selection = PaymentSelection.create(input.provider, input.provider);
    if (!selection.ok) return err(selection.error);
    return this.deps.unitOfWork.run<Result<{ readonly checkoutSessionId: string }, DomainError>>(
      async (tx) => {
        const session = await this.deps.sessions.findById(
          input.checkoutSessionId,
          input.tenantId,
          tx,
        );
        if (session === null) return err(new NotFoundError("Checkout session not found"));
        if (session.draftTerms === undefined) {
          return err(
            new BusinessRuleError("Only a draft order's checkout takes a merchant payment"),
          );
        }
        try {
          session.selectPayment(selection.value);
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.sessions.save(session, input.tenantId, tx);
        return ok({ checkoutSessionId: input.checkoutSessionId });
      },
    );
  }
}

export interface QuoteDraftShippingInput {
  readonly tenantId: string;
  readonly currency: string;
  readonly address: {
    readonly country: string;
    readonly province?: string;
    readonly postalCode: string;
  };
  readonly items: LoadItemsInput["items"];
}

/** Spec §4.3: the shop's rates for a draft's address — the SAME `ShippingCalculationPort` checkout uses. */
export class QuoteDraftShipping implements UseCase<
  QuoteDraftShippingInput,
  { readonly quotes: readonly ShippingQuote[] },
  DomainError
> {
  private readonly deps: { readonly shippingCalculation: ShippingCalculationPort };

  constructor(deps: { readonly shippingCalculation: ShippingCalculationPort }) {
    this.deps = deps;
  }

  async execute(
    input: QuoteDraftShippingInput,
  ): Promise<Result<{ readonly quotes: readonly ShippingQuote[] }, DomainError>> {
    const items = checkoutItemsFrom(input.items);
    if (!items.ok) return err(items.error);
    const quotes = await this.deps.shippingCalculation.quote(
      input.address,
      items.value,
      input.currency,
      input.tenantId,
    );
    return ok({ quotes });
  }
}

export interface EstimateDraftTaxInput {
  readonly tenantId: string;
  readonly currency: string;
  readonly items: LoadItemsInput["items"];
  readonly destination: { readonly country: string; readonly province?: string };
  readonly shippingMinor: number;
  readonly discountMinor: number;
}

/** Spec §4.3 "Estimated tax": Finance's answer for the draft's figures — read-only, nothing stored. */
export class EstimateDraftTax implements UseCase<
  EstimateDraftTaxInput,
  TaxCalculationResult,
  DomainError
> {
  private readonly deps: { readonly taxCalculation: TaxCalculationPort };

  constructor(deps: { readonly taxCalculation: TaxCalculationPort }) {
    this.deps = deps;
  }

  async execute(input: EstimateDraftTaxInput): Promise<Result<TaxCalculationResult, DomainError>> {
    const items = checkoutItemsFrom(input.items);
    if (!items.ok) return err(items.error);
    return ok(
      await this.deps.taxCalculation.calculate(
        items.value,
        input.destination,
        input.shippingMinor,
        input.currency,
        input.tenantId,
        { orderMinor: input.discountMinor, shippingMinor: 0 },
      ),
    );
  }
}

export interface IssueInvoiceLinkInput {
  readonly tenantId: string;
  readonly draftOrderRef: string;
  /** The staff principal id. */
  readonly createdBy: string;
}

export interface IssueInvoiceLinkOutput {
  readonly linkId: string;
  /** Handed out exactly once: only its hash is stored (Ruling 21). Never logged. */
  readonly token: string;
  readonly expiresAt: string;
}

/** Spec §4.7: a new 30-day invoice link pointing at the DRAFT (not one session). */
export class IssueInvoiceLink implements UseCase<
  IssueInvoiceLinkInput,
  IssueInvoiceLinkOutput,
  DomainError
> {
  private readonly deps: DraftCheckoutDeps;

  constructor(deps: DraftCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: IssueInvoiceLinkInput,
  ): Promise<Result<IssueInvoiceLinkOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IssueInvoiceLinkOutput, DomainError>>(async (tx) => {
      let issued: ReturnType<typeof CheckoutLink.issue>;
      try {
        issued = CheckoutLink.issue({
          id: this.deps.idGenerator.generate(),
          purpose: "invoice",
          target: { draftOrderRef: input.draftOrderRef },
          createdBy: input.createdBy,
          now: this.deps.clock.now(),
          ttlMs: INVOICE_LINK_TTL_MS,
        });
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.links.save(issued.link, input.tenantId, tx);
      return ok({
        linkId: issued.link.id,
        token: issued.token,
        expiresAt: issued.link.expiresAt.toISOString(),
      });
    });
  }
}

export interface ClaimInvoiceCheckoutInput {
  readonly tenantId: string;
  readonly linkId: string;
  /** The draft's current session (the admin route materialised it from the latest draft). */
  readonly checkoutSessionId: string;
  /** The opener's OWN guest cookie value. */
  readonly sessionRef: string;
}

/**
 * Spec §4.7 claim, ONE unit of work: the guarded, atomic claim count first (a revoked or expired link
 * never changes hands), then `transferOwnership` to the opener. The session must still be open and be
 * the link's draft's; otherwise DRAFT_BUSY (it was replaced or completed meanwhile).
 */
export class ClaimInvoiceCheckout implements UseCase<
  ClaimInvoiceCheckoutInput,
  { readonly checkoutSessionId: string; readonly claimCount: number },
  DomainError
> {
  private readonly deps: DraftCheckoutDeps;

  constructor(deps: DraftCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: ClaimInvoiceCheckoutInput,
  ): Promise<
    Result<{ readonly checkoutSessionId: string; readonly claimCount: number }, DomainError>
  > {
    // Refused before anything is counted: an empty owner could never take the session over.
    const sessionRef = Guard.againstEmpty(input.sessionRef, "sessionRef");
    if (!sessionRef.ok) return err(sessionRef.error);
    return this.deps.unitOfWork.run<
      Result<{ readonly checkoutSessionId: string; readonly claimCount: number }, DomainError>
    >(async (tx) => {
      const now = this.deps.clock.now();
      const link = await this.deps.links.findById(input.linkId, input.tenantId, tx);
      if (link === null || !link.isUsable(now) || link.purpose !== "invoice") {
        return err(linkInvalid());
      }
      const session = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (
        session === null ||
        !session.state.isOpen ||
        session.draftTerms?.draftOrderRef !== link.draftOrderRef
      ) {
        return err(draftCheckoutGone());
      }
      const claimCount = await this.deps.links.recordClaim(
        link.id,
        input.tenantId,
        now,
        input.checkoutSessionId,
        tx,
      );
      // A null count wrote nothing (the guarded update did not apply), so this `err` commits nothing.
      if (claimCount === null) return err(linkInvalid());
      // Every refusal of `transferOwnership` (not open, not a draft's, no owner) was checked above, so
      // none is returned as an `err` after the count: the unit of work commits on a returned `err`, and
      // a throw here rolls the count back instead.
      session.transferOwnership(input.sessionRef);
      await this.deps.sessions.save(session, input.tenantId, tx);
      return ok({ checkoutSessionId: input.checkoutSessionId, claimCount });
    });
  }
}

export interface DraftLinksInput {
  readonly tenantId: string;
  readonly draftOrderRef: string;
}

/** Spec §4.6 step 5 / Ruling 17: the draft's invoice links stop working (deleted draft). */
export class RevokeDraftLinks implements UseCase<
  DraftLinksInput,
  { readonly revoked: number },
  DomainError
> {
  private readonly deps: DraftCheckoutDeps;

  constructor(deps: DraftCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: DraftLinksInput,
  ): Promise<Result<{ readonly revoked: number }, DomainError>> {
    // One guarded update of `revokedAt` only — the claim fields stay `recordClaim`'s (binding carry 1).
    return this.deps.unitOfWork.run<Result<{ readonly revoked: number }, DomainError>>(async (tx) =>
      ok({
        revoked: await this.deps.links.revokeForDraft(
          input.draftOrderRef,
          input.tenantId,
          this.deps.clock.now(),
          tx,
        ),
      }),
    );
  }
}

/** The draft page's links (issued, expires, claim count). */
export class ListDraftLinks implements UseCase<
  DraftLinksInput,
  readonly CheckoutLink[],
  DomainError
> {
  private readonly deps: Pick<DraftCheckoutDeps, "links">;

  constructor(deps: Pick<DraftCheckoutDeps, "links">) {
    this.deps = deps;
  }

  async execute(input: DraftLinksInput): Promise<Result<readonly CheckoutLink[], DomainError>> {
    return ok(await this.deps.links.listForDraft(input.draftOrderRef, input.tenantId));
  }
}
