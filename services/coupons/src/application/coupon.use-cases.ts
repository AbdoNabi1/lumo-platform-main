import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type CursorPage, type Paginated, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { Coupon } from "../domain/coupon";
import type { CouponRepository } from "../domain/coupon-repository";
import { CouponCode } from "../domain/value-objects/coupon-code";
import type { CouponStatusValue } from "../domain/value-objects/coupon-status";
import type { PromotionsPort } from "./ports";

export interface CreateCouponInput {
  readonly code: string;
  readonly promotionRef: string;
  readonly multiUse: boolean;
  readonly usageLimit?: number;
  readonly customerRef?: string;
  readonly expiresAt?: Date;
  readonly campaignRef?: string;
  readonly tenantId: string;
}

export interface CouponStatusOutput {
  readonly couponId: string;
  readonly status: string;
}

export interface CouponIdInput {
  readonly couponId: string;
  readonly tenantId: string;
}

export interface AdvanceCouponInput extends CouponIdInput {
  readonly toStatus: CouponStatusValue;
}

export interface CouponDeps {
  readonly coupons: CouponRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates a coupon in `active` status. */
export class CreateCoupon implements UseCase<CreateCouponInput, CouponStatusOutput, DomainError> {
  private readonly deps: CouponDeps;

  constructor(deps: CouponDeps) {
    this.deps = deps;
  }

  async execute(input: CreateCouponInput): Promise<Result<CouponStatusOutput, DomainError>> {
    const code = CouponCode.create(input.code);
    if (!code.ok) return err(code.error);
    const promotionRef = Guard.againstEmpty(input.promotionRef, "promotionRef");
    if (!promotionRef.ok) return err(promotionRef.error);

    return this.deps.unitOfWork.run<Result<CouponStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.coupons.findByCode(code.value.value, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Coupon code "${code.value.value}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const coupon = Coupon.create(
        id,
        code.value,
        input.promotionRef,
        input.multiUse,
        input.usageLimit,
        input.customerRef,
        input.expiresAt,
        input.campaignRef,
      );
      await this.deps.coupons.save(coupon, input.tenantId, tx);
      return ok({ couponId: id.toString(), status: coupon.status.value });
    });
  }
}

/** Generic validated transition — used for disable/reactivate/expire. */
export class AdvanceCoupon implements UseCase<AdvanceCouponInput, CouponStatusOutput, DomainError> {
  private readonly deps: CouponDeps;

  constructor(deps: CouponDeps) {
    this.deps = deps;
  }

  async execute(input: AdvanceCouponInput): Promise<Result<CouponStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<CouponStatusOutput, DomainError>>(async (tx) => {
      const coupon = await this.deps.coupons.findById(input.couponId, input.tenantId, tx);
      if (coupon === null) return err(new NotFoundError("Coupon not found"));

      try {
        coupon.transition(input.toStatus, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.coupons.save(coupon, input.tenantId, tx);
      return ok({ couponId: coupon.id.toString(), status: coupon.status.value });
    });
  }
}

export interface RedeemCouponInput {
  readonly code: string;
  readonly customerRef: string;
  readonly idempotencyKey: string;
  readonly orderRef?: string;
  readonly tenantId: string;
}

export interface RedeemCouponOutput extends CouponStatusOutput {
  readonly promotionRef: string;
  readonly duplicate: boolean;
}

export interface RedeemCouponDeps extends CouponDeps {
  readonly promotions: PromotionsPort;
}

/** Redeems a coupon by code, idempotent by `idempotencyKey`, verifying the promotion is active via `PromotionsPort`. */
export class RedeemCoupon implements UseCase<RedeemCouponInput, RedeemCouponOutput, DomainError> {
  private readonly deps: RedeemCouponDeps;

  constructor(deps: RedeemCouponDeps) {
    this.deps = deps;
  }

  async execute(input: RedeemCouponInput): Promise<Result<RedeemCouponOutput, DomainError>> {
    const idempotencyKey = Guard.againstEmpty(input.idempotencyKey, "idempotencyKey");
    if (!idempotencyKey.ok) return err(idempotencyKey.error);

    return this.deps.unitOfWork.run<Result<RedeemCouponOutput, DomainError>>(async (tx) => {
      const coupon = await this.deps.coupons.findByCode(
        input.code.trim().toUpperCase(),
        input.tenantId,
        tx,
      );
      if (coupon === null) return err(new NotFoundError("Coupon not found"));

      const alreadyRedeemed = await this.deps.coupons.hasRedemption(
        coupon.id.toString(),
        input.idempotencyKey,
        input.tenantId,
        tx,
      );
      if (alreadyRedeemed) {
        return ok({
          couponId: coupon.id.toString(),
          status: coupon.status.value,
          promotionRef: coupon.promotionRef,
          duplicate: true,
        });
      }

      const promotionActive = await this.deps.promotions.isActive(coupon.promotionRef);
      if (!promotionActive) {
        return err(new ConflictError("The promotion this coupon authorizes is not active"));
      }

      try {
        coupon.redeem(
          input.idempotencyKey,
          input.customerRef,
          this.deps.clock.now(),
          this.deps.idGenerator.generate(),
          input.orderRef,
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.coupons.save(coupon, input.tenantId, tx);
      return ok({
        couponId: coupon.id.toString(),
        status: coupon.status.value,
        promotionRef: coupon.promotionRef,
        duplicate: false,
      });
    });
  }
}

export interface ListCouponsInput extends CursorPage {
  readonly tenantId: string;
}

export interface ListCouponsDeps {
  readonly coupons: CouponRepository;
}

/** Cursor-paginated coupon listing, most recently created first (Phase A.30 admin Discounts screen). */
export class ListCoupons implements UseCase<ListCouponsInput, Paginated<Coupon>, DomainError> {
  private readonly deps: ListCouponsDeps;

  constructor(deps: ListCouponsDeps) {
    this.deps = deps;
  }

  async execute(input: ListCouponsInput): Promise<Result<Paginated<Coupon>, DomainError>> {
    return ok(await this.deps.coupons.list(input, input.tenantId));
  }
}
