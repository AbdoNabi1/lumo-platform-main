import type {
  AdvanceCoupon,
  AdvanceCouponInput,
  CreateCoupon,
  CreateCouponInput,
  FindPromotionRefsByCode,
  GetCouponByCode,
  ListCoupons,
  ListCouponsByPromotionRefs,
  ListCouponsInput,
  ReconfigureCoupon,
  ReconfigureCouponInput,
  RedeemCoupon,
  RedeemCouponInput,
} from "../application/coupon.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface CouponsControllerDeps {
  readonly createCoupon: CreateCoupon;
  readonly advanceCoupon: AdvanceCoupon;
  readonly redeemCoupon: RedeemCoupon;
  readonly listCoupons: ListCoupons;
  readonly getCouponByCode: GetCouponByCode;
  readonly listCouponsByPromotionRefs: ListCouponsByPromotionRefs;
  readonly findPromotionRefsByCode: FindPromotionRefsByCode;
  readonly reconfigureCoupon: ReconfigureCoupon;
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

  async getByCode(input: {
    readonly tenantId: string;
    readonly code: string;
  }): Promise<ControllerResponse> {
    return present(await this.deps.getCouponByCode.execute(input), 200);
  }

  async listByPromotionRefs(input: {
    readonly tenantId: string;
    readonly promotionRefs: readonly string[];
  }): Promise<ControllerResponse> {
    return present(await this.deps.listCouponsByPromotionRefs.execute(input), 200);
  }

  async findPromotionRefsByCode(input: {
    readonly tenantId: string;
    readonly fragment: string;
  }): Promise<ControllerResponse> {
    return present(await this.deps.findPromotionRefsByCode.execute(input), 200);
  }

  async reconfigure(input: ReconfigureCouponInput): Promise<ControllerResponse> {
    return present(await this.deps.reconfigureCoupon.execute(input), 200);
  }
}
