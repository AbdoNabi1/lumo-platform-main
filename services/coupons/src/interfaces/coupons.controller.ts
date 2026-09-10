import type {
  AdvanceCoupon,
  AdvanceCouponInput,
  CreateCoupon,
  CreateCouponInput,
  ListCoupons,
  ListCouponsInput,
  RedeemCoupon,
  RedeemCouponInput,
} from "../application/coupon.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface CouponsControllerDeps {
  readonly createCoupon: CreateCoupon;
  readonly advanceCoupon: AdvanceCoupon;
  readonly redeemCoupon: RedeemCoupon;
  readonly listCoupons: ListCoupons;
}

/** Framework-agnostic interface boundary for coupons use-cases (no HTTP server). */
export class CouponsController {
  private readonly deps: CouponsControllerDeps;

  constructor(deps: CouponsControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateCouponInput): Promise<ControllerResponse> {
    return present(await this.deps.createCoupon.execute(input), 201);
  }

  async advance(input: AdvanceCouponInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceCoupon.execute(input), 200);
  }

  async redeem(input: RedeemCouponInput): Promise<ControllerResponse> {
    return present(await this.deps.redeemCoupon.execute(input), 200);
  }

  async list(input: ListCouponsInput): Promise<ControllerResponse> {
    return present(await this.deps.listCoupons.execute(input), 200);
  }
}
