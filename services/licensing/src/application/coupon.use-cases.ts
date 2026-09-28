import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError, NotFoundError, isDomainError } from "@platform/utils";
import { Coupon, type CouponValue } from "../domain/coupon";
import type { CouponRepository, InvoiceRepository } from "../domain/repositories";
import { withConcurrencyRetry } from "./billing.use-cases";

export interface CouponDeps {
  readonly coupons: CouponRepository;
  readonly invoices: InvoiceRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Bounded retry on the coupon's and the invoice's optimistic lock. The retry is what turns a lost
 * race into a CLEAN refusal: the loser's whole transaction rolled back, so re-running it re-reads the
 * coupon the winner already redeemed and the machine refuses (`redeemed -> redeemed` has no edge)
 * instead of the caller seeing a raw concurrency error — and never a second discount.
 */
const MAX_ATTEMPTS = 5;

export interface IssueCouponInput {
  readonly code: string;
  readonly value: CouponValue;
  readonly expiresAt: Date;
  /** Address the coupon to one merchant (`tenantRef`); absent means a bearer coupon. */
  readonly merchantRef?: string;
  readonly tenantId: string;
}

export interface CouponIdOutput {
  readonly id: string;
}

/** Issues a coupon. Platform-only at `LicensingController`: Morbeh prices its own bill, a merchant never. */
export class IssueCoupon implements UseCase<IssueCouponInput, CouponIdOutput, DomainError> {
  private readonly deps: CouponDeps;

  constructor(deps: CouponDeps) {
    this.deps = deps;
  }

  async execute(input: IssueCouponInput): Promise<Result<CouponIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<CouponIdOutput, DomainError>>(async (tx) => {
      let coupon: Coupon;
      try {
        coupon = Coupon.issue(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          {
            code: input.code,
            value: input.value,
            expiresAt: input.expiresAt,
            ...(input.merchantRef === undefined ? {} : { merchantRef: input.merchantRef }),
          },
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      // (tenant_id, code) is also UNIQUE in the database: this read is the friendly refusal, the index
      // is the backstop for two issuers racing the same code.
      if ((await this.deps.coupons.findByCode(coupon.code, input.tenantId, tx)) !== null) {
        return err(new ConflictError(`A coupon with code ${coupon.code} already exists`));
      }
      await this.deps.coupons.save(coupon, input.tenantId, tx);
      return ok({ id: coupon.id.toString() });
    });
  }
}

export interface RedeemCouponInput {
  readonly code: string;
  readonly invoiceId: string;
  readonly tenantId: string;
}

export interface RedeemCouponOutput {
  readonly couponId: string;
  readonly invoiceId: string;
  readonly discountMinor: number;
  /** The invoice total after the discount — what will reach the PSP. */
  readonly totalMinor: number;
}

/**
 * Redeems a coupon onto a DRAFT invoice, reducing its total (D-072). One transaction reads the coupon
 * and the invoice, checks BOTH before mutating EITHER (a refusal leaves neither half-changed, even on
 * an in-memory repository that hands aggregates out by reference), applies both, and saves the coupon
 * FIRST — its optimistic lock is the redeem-once guard: of N concurrent redemptions exactly one save
 * commits, every other throws `ConcurrencyError`, rolls its transaction back, and is retried against
 * the now-`redeemed` coupon.
 */
export class RedeemCoupon implements UseCase<RedeemCouponInput, RedeemCouponOutput, DomainError> {
  private readonly deps: CouponDeps;

  constructor(deps: CouponDeps) {
    this.deps = deps;
  }

  async execute(input: RedeemCouponInput): Promise<Result<RedeemCouponOutput, DomainError>> {
    const code = input.code.trim().toUpperCase();
    return withConcurrencyRetry(MAX_ATTEMPTS, () =>
      this.deps.unitOfWork.run<Result<RedeemCouponOutput, DomainError>>(async (tx) => {
        const coupon = await this.deps.coupons.findByCode(code, input.tenantId, tx);
        if (coupon === null) return err(new NotFoundError("Coupon not found"));
        const invoice = await this.deps.invoices.findById(input.invoiceId, input.tenantId, tx);
        if (invoice === null) return err(new NotFoundError("Invoice not found"));

        const now = this.deps.clock.now();
        let discountMinor: number;
        try {
          const discount = coupon.discountFor(invoice.subtotal);
          coupon.assertRedeemable(invoice.tenantRef, now);
          invoice.assertCanDiscount(discount);
          coupon.redeem(
            invoice.id.toString(),
            invoice.tenantRef,
            this.deps.idGenerator.generate(),
            now,
          );
          invoice.applyDiscount(
            coupon.id.toString(),
            discount,
            this.deps.idGenerator.generate(),
            now,
          );
          discountMinor = discount.amountMinor;
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.coupons.save(coupon, input.tenantId, tx);
        await this.deps.invoices.save(invoice, input.tenantId, tx);
        return ok({
          couponId: coupon.id.toString(),
          invoiceId: invoice.id.toString(),
          discountMinor,
          totalMinor: invoice.totalMinor,
        });
      }),
    );
  }
}

export interface CouponActionInput {
  readonly couponId: string;
  readonly tenantId: string;
}

export interface RevokeCouponInput extends CouponActionInput {
  readonly reason: string;
}

/** Marks an `issued` coupon `expired` once its expiry has passed (the sweep's or an operator's move). */
export class ExpireCoupon implements UseCase<CouponActionInput, CouponIdOutput, DomainError> {
  private readonly deps: CouponDeps;

  constructor(deps: CouponDeps) {
    this.deps = deps;
  }

  async execute(input: CouponActionInput): Promise<Result<CouponIdOutput, DomainError>> {
    return withConcurrencyRetry(MAX_ATTEMPTS, () =>
      this.deps.unitOfWork.run<Result<CouponIdOutput, DomainError>>(async (tx) => {
        const coupon = await this.deps.coupons.findById(input.couponId, input.tenantId, tx);
        if (coupon === null) return err(new NotFoundError("Coupon not found"));
        try {
          coupon.expire(this.deps.idGenerator.generate(), this.deps.clock.now());
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.coupons.save(coupon, input.tenantId, tx);
        return ok({ id: coupon.id.toString() });
      }),
    );
  }
}

/** Withdraws an `issued` coupon. A redeemed one cannot be revoked: its discount is already on an invoice. */
export class RevokeCoupon implements UseCase<RevokeCouponInput, CouponIdOutput, DomainError> {
  private readonly deps: CouponDeps;

  constructor(deps: CouponDeps) {
    this.deps = deps;
  }

  async execute(input: RevokeCouponInput): Promise<Result<CouponIdOutput, DomainError>> {
    return withConcurrencyRetry(MAX_ATTEMPTS, () =>
      this.deps.unitOfWork.run<Result<CouponIdOutput, DomainError>>(async (tx) => {
        const coupon = await this.deps.coupons.findById(input.couponId, input.tenantId, tx);
        if (coupon === null) return err(new NotFoundError("Coupon not found"));
        try {
          coupon.revoke(input.reason, this.deps.idGenerator.generate(), this.deps.clock.now());
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.coupons.save(coupon, input.tenantId, tx);
        return ok({ id: coupon.id.toString() });
      }),
    );
  }
}
