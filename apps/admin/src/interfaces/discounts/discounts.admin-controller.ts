import type { Clock, Principal } from "@platform/contracts";
import type { Coupon, CouponsController } from "@platform/coupons";
import type { Promotion, PromotionsController } from "@platform/promotions";
import type { Paginated } from "@platform/types";
import { NotFoundError, ValidationError, toErrorEnvelope } from "@platform/utils";
import type { AdminGuard } from "../admin-guard";
import type { AdminResponse } from "../admin-response";
import { discountMethodOf, discountTypeOf, toDiscountDto, toPromotionFields } from "./discount-dto";
import type { DiscountInput } from "./discount-input";

export interface DiscountsAdminControllerDeps {
  readonly promotions: PromotionsController;
  readonly coupons: CouponsController;
  readonly guard: AdminGuard;
  readonly clock: Clock;
}

type DiscountView = "all" | "active" | "scheduled" | "expired";

function fieldError(field: string, message: string): AdminResponse {
  return {
    status: 422,
    body: toErrorEnvelope(new ValidationError("Invalid discount", [{ field, message }])),
  };
}

const codeTaken = () => fieldError("code", "This code is already in use");
const notFound = (): AdminResponse => ({
  status: 404,
  body: toErrorEnvelope(new NotFoundError("Discount not found")),
});
const isOk = (response: AdminResponse) => response.status >= 200 && response.status < 300;

/**
 * The admin Discounts screen's API (Phase 2): one Shopify-style discount over a Promotion (the
 * rule) and, for a code, a Coupon (the code, its limits, its usage). The merchant never sees the
 * split. Reads need `promotions:read`; every write needs `promotions:create` — the two permissions
 * the Ory seed grants.
 */
export class DiscountsAdminController {
  private readonly deps: DiscountsAdminControllerDeps;

  constructor(deps: DiscountsAdminControllerDeps) {
    this.deps = deps;
  }

  async list(
    principal: Principal,
    input: {
      readonly tenantId: string;
      readonly view: DiscountView;
      readonly q?: string;
      readonly first?: number;
      readonly after?: string;
    },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "promotions:read");
    if (denied) return denied;
    const q = input.q?.trim() ?? "";
    let alsoIds: readonly string[] = [];
    if (q !== "") {
      const found = await this.deps.coupons.findPromotionRefsByCode({
        tenantId: input.tenantId,
        fragment: q,
      });
      if (isOk(found))
        alsoIds = (found.body as { readonly promotionRefs: readonly string[] }).promotionRefs;
    }
    const page = await this.deps.promotions.listForAdmin({
      tenantId: input.tenantId,
      view: input.view,
      ...(q === "" ? {} : { search: q, alsoIds }),
      ...(input.first === undefined ? {} : { first: input.first }),
      ...(input.after === undefined ? {} : { after: input.after }),
    });
    if (!isOk(page)) return page;
    const { items, pageInfo } = page.body as Paginated<Promotion>;
    const coupons = await this.couponsOf(
      input.tenantId,
      items.map((p) => p.id.toString()),
    );
    const now = this.deps.clock.now();
    return {
      status: 200,
      body: {
        items: items.map((p) => toDiscountDto(p, coupons.get(p.id.toString()), now)),
        pageInfo,
      },
    };
  }

  async get(
    principal: Principal,
    input: { readonly tenantId: string; readonly discountId: string },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "promotions:read");
    if (denied) return denied;
    return this.read(input.tenantId, input.discountId, 200);
  }

  async create(
    principal: Principal,
    input: { readonly tenantId: string; readonly input: DiscountInput },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "promotions:create");
    if (denied) return denied;
    const { tenantId, input: discount } = input;
    if (discount.method === "code") {
      const holder = await this.deps.coupons.getByCode({ tenantId, code: discount.code ?? "" });
      if (holder.status === 200) return codeTaken();
    }
    const created = await this.deps.promotions.create({
      tenantId,
      method: discount.method,
      ...toPromotionFields(discount),
    });
    if (created.status !== 201) return created;
    const { promotionId } = created.body as { readonly promotionId: string };
    if (discount.method === "code") {
      const coupon = await this.deps.coupons.create({
        tenantId,
        code: discount.code ?? "",
        promotionRef: promotionId,
        multiUse: !discount.oncePerCustomer,
        ...(discount.usageLimit === undefined ? {} : { usageLimit: discount.usageLimit }),
      });
      if (coupon.status !== 201) {
        await this.deps.promotions.advance({ tenantId, promotionId, toStatus: "cancelled" });
        return coupon.status === 409 ? codeTaken() : coupon;
      }
    }
    const activated = await this.deps.promotions.advance({
      tenantId,
      promotionId,
      toStatus: "active",
    });
    if (!isOk(activated)) return activated;
    return this.read(tenantId, promotionId, 201);
  }

  async update(
    principal: Principal,
    input: {
      readonly tenantId: string;
      readonly discountId: string;
      readonly input: DiscountInput;
    },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "promotions:create");
    if (denied) return denied;
    const { tenantId, discountId, input: discount } = input;
    const loaded = await this.load(tenantId, discountId);
    if (loaded === null) return notFound();
    const { promotion, coupon } = loaded;
    if (
      discount.type !== discountTypeOf(promotion) ||
      discount.method !== discountMethodOf(promotion, coupon)
    ) {
      return fieldError("type", "A discount's type and method cannot be changed");
    }
    if (discount.method === "code") {
      const holder = await this.deps.coupons.getByCode({ tenantId, code: discount.code ?? "" });
      if (holder.status === 200 && (holder.body as Coupon).promotionRef !== discountId)
        return codeTaken();
    }
    // The form's fields go first, so nothing in them can replace the tenant or the promotion id.
    const updated = await this.deps.promotions.update({
      ...toPromotionFields(discount),
      tenantId,
      promotionId: discountId,
    });
    if (!isOk(updated)) return updated;
    if (coupon !== undefined) {
      const reconfigured = await this.deps.coupons.reconfigure({
        tenantId,
        couponId: coupon.id.toString(),
        code: discount.code ?? coupon.code.value,
        multiUse: !discount.oncePerCustomer,
        ...(discount.usageLimit === undefined ? {} : { usageLimit: discount.usageLimit }),
      });
      if (reconfigured.status === 409) return codeTaken();
      if (!isOk(reconfigured)) return reconfigured;
    }
    return this.read(tenantId, discountId, 200);
  }

  /** Shopify's "Deactivate": the discount stops at once and reads as expired. */
  async deactivate(
    principal: Principal,
    input: { readonly tenantId: string; readonly discountId: string },
  ): Promise<AdminResponse> {
    return this.transition(principal, input, {
      promotionFrom: "active",
      promotionTo: "paused",
      couponFrom: "active",
      couponTo: "disabled",
    });
  }

  async activate(
    principal: Principal,
    input: { readonly tenantId: string; readonly discountId: string },
  ): Promise<AdminResponse> {
    return this.transition(principal, input, {
      promotionFrom: "paused",
      promotionTo: "active",
      couponFrom: "disabled",
      couponTo: "active",
    });
  }

  /** Deleting archives the promotion (it leaves every list) and disables its code. */
  async remove(
    principal: Principal,
    input: { readonly tenantId: string; readonly discountId: string },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "promotions:create");
    if (denied) return denied;
    const loaded = await this.load(input.tenantId, input.discountId);
    if (loaded === null) return notFound();
    const archived = await this.deps.promotions.advance({
      tenantId: input.tenantId,
      promotionId: input.discountId,
      toStatus: "archived",
    });
    if (!isOk(archived)) return archived;
    if (loaded.coupon !== undefined && loaded.coupon.status.value === "active") {
      await this.deps.coupons.advance({
        tenantId: input.tenantId,
        couponId: loaded.coupon.id.toString(),
        toStatus: "disabled",
      });
    }
    return { status: 200, body: { id: input.discountId, deleted: true } };
  }

  private async transition(
    principal: Principal,
    input: { readonly tenantId: string; readonly discountId: string },
    steps: {
      readonly promotionFrom: string;
      readonly promotionTo: "paused" | "active";
      readonly couponFrom: string;
      readonly couponTo: "disabled" | "active";
    },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "promotions:create");
    if (denied) return denied;
    const loaded = await this.load(input.tenantId, input.discountId);
    if (loaded === null) return notFound();
    if (loaded.promotion.status.value === steps.promotionFrom) {
      const moved = await this.deps.promotions.advance({
        tenantId: input.tenantId,
        promotionId: input.discountId,
        toStatus: steps.promotionTo,
      });
      if (!isOk(moved)) return moved;
    }
    if (loaded.coupon !== undefined && loaded.coupon.status.value === steps.couponFrom) {
      const moved = await this.deps.coupons.advance({
        tenantId: input.tenantId,
        couponId: loaded.coupon.id.toString(),
        toStatus: steps.couponTo,
      });
      if (!isOk(moved)) return moved;
    }
    return this.read(input.tenantId, input.discountId, 200);
  }

  private async load(
    tenantId: string,
    discountId: string,
  ): Promise<{ readonly promotion: Promotion; readonly coupon: Coupon | undefined } | null> {
    const response = await this.deps.promotions.get({ tenantId, promotionId: discountId });
    if (response.status !== 200) return null;
    const promotion = response.body as Promotion;
    if (promotion.status.value === "archived") return null;
    return { promotion, coupon: (await this.couponsOf(tenantId, [discountId])).get(discountId) };
  }

  private async couponsOf(
    tenantId: string,
    promotionRefs: readonly string[],
  ): Promise<Map<string, Coupon>> {
    if (promotionRefs.length === 0) return new Map();
    const response = await this.deps.coupons.listByPromotionRefs({ tenantId, promotionRefs });
    const items = isOk(response)
      ? (response.body as { readonly items: readonly Coupon[] }).items
      : [];
    return new Map(items.map((c) => [c.promotionRef, c]));
  }

  private async read(tenantId: string, discountId: string, status: number): Promise<AdminResponse> {
    const loaded = await this.load(tenantId, discountId);
    if (loaded === null) return notFound();
    return { status, body: toDiscountDto(loaded.promotion, loaded.coupon, this.deps.clock.now()) };
  }
}
