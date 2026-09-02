import type { Principal } from "@platform/contracts";
import type { PriceController, PriceListController, RegistryController } from "@platform/pricing";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface PricingAdminControllerDeps {
  readonly prices: PriceController;
  readonly priceLists: PriceListController;
  readonly registry: RegistryController;
  readonly guard: AdminGuard;
}

/**
 * Wires the frozen **Discounts** + **Coupons** admin screens to the Pricing context. Pure delegation
 * over Pricing's price-list/price operations. Every action authorizes the acting principal first
 * (RBAC seam, ADR-0007; permissive until real RBAC lands). Dedicated `Coupon`/`DiscountRule`
 * aggregates (the 0.5 design's Pricing shape) are **deferred** — Pricing was implemented as
 * Price/PriceList in Sprint 1.2; these screens operate on that existing surface until
 * coupons/discount-rules are built.
 */
export class PricingAdminController {
  private readonly prices: PriceController;
  private readonly priceLists: PriceListController;
  private readonly registry: RegistryController;
  private readonly guard: AdminGuard;

  constructor(deps: PricingAdminControllerDeps) {
    this.prices = deps.prices;
    this.priceLists = deps.priceLists;
    this.registry = deps.registry;
    this.guard = deps.guard;
  }

  async createPriceList(
    principal: Principal,
    input: Parameters<PriceListController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pricing:create_price_list");
    if (denied) return denied;
    return this.priceLists.create(input);
  }

  async activatePriceList(
    principal: Principal,
    input: Parameters<PriceListController["activate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pricing:activate_price_list");
    if (denied) return denied;
    return this.priceLists.activate(input);
  }

  async createPrice(
    principal: Principal,
    input: Parameters<PriceController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pricing:create_price");
    if (denied) return denied;
    return this.prices.create(input);
  }

  async changePrice(
    principal: Principal,
    input: Parameters<PriceController["change"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pricing:change_price");
    if (denied) return denied;
    return this.prices.change(input);
  }

  async publishPrice(
    principal: Principal,
    input: Parameters<PriceController["publish"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pricing:publish_price");
    if (denied) return denied;
    return this.prices.publish(input);
  }

  async createTaxClass(
    principal: Principal,
    input: Parameters<RegistryController["createTaxClass"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pricing:create_tax_class");
    if (denied) return denied;
    return this.registry.createTaxClass(input);
  }

  async createPricingRule(
    principal: Principal,
    input: Parameters<RegistryController["createPricingRule"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pricing:create_pricing_rule");
    if (denied) return denied;
    return this.registry.createPricingRule(input);
  }
}
