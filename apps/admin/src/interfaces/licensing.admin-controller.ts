import type { Principal } from "@platform/contracts";
import type { LicensingController } from "@platform/licensing";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface LicensingAdminControllerDeps {
  readonly licensing: LicensingController;
  readonly guard: AdminGuard;
}

/** Wires the Licensing admin screen to the Licensing context (Sprint 5.5/5.6). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class LicensingAdminController {
  private readonly licensing: LicensingController;
  private readonly guard: AdminGuard;

  constructor(deps: LicensingAdminControllerDeps) {
    this.licensing = deps.licensing;
    this.guard = deps.guard;
  }

  async createPlan(
    principal: Principal,
    input: Parameters<LicensingController["createPlan"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:plan:manage");
    if (denied) return denied;
    return this.licensing.createPlan(input);
  }

  async createPlanDraft(
    principal: Principal,
    input: Parameters<LicensingController["createPlanDraft"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:plan:manage");
    if (denied) return denied;
    return this.licensing.createPlanDraft(input);
  }

  async publishPlanVersion(
    principal: Principal,
    input: Parameters<LicensingController["publishPlanVersion"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:plan:manage");
    if (denied) return denied;
    return this.licensing.publishPlanVersion(input);
  }

  async rollbackPlan(
    principal: Principal,
    input: Parameters<LicensingController["rollbackPlan"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:plan:manage");
    if (denied) return denied;
    return this.licensing.rollbackPlan(input);
  }

  async createSubscription(
    principal: Principal,
    input: Parameters<LicensingController["createSubscription"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:subscription:manage");
    if (denied) return denied;
    return this.licensing.createSubscription(input);
  }

  async repinSubscription(
    principal: Principal,
    input: Parameters<LicensingController["repinSubscription"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:subscription:manage");
    if (denied) return denied;
    return this.licensing.repinSubscription(input);
  }

  async cancelSubscription(
    principal: Principal,
    input: Parameters<LicensingController["cancelSubscription"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:subscription:manage");
    if (denied) return denied;
    return this.licensing.cancelSubscription(input);
  }

  async setMerchantFeatureOverride(
    principal: Principal,
    input: Parameters<LicensingController["setMerchantFeatureOverride"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:override:manage");
    if (denied) return denied;
    return this.licensing.setMerchantFeatureOverride(input);
  }

  async grantMerchantCapability(
    principal: Principal,
    input: Parameters<LicensingController["grantMerchantCapability"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:override:manage");
    if (denied) return denied;
    return this.licensing.grantMerchantCapability(input);
  }

  async getUsageCounter(
    principal: Principal,
    input: Parameters<LicensingController["getUsageCounter"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:usage:read");
    if (denied) return denied;
    return this.licensing.getUsageCounter(input);
  }

  async createInvoice(
    principal: Principal,
    input: Parameters<LicensingController["createInvoice"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:billing:manage");
    if (denied) return denied;
    return this.licensing.createInvoice(input);
  }

  async collectInvoice(
    principal: Principal,
    input: Parameters<LicensingController["collectInvoice"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:billing:manage");
    if (denied) return denied;
    return this.licensing.collectInvoice(input);
  }

  async grantCredit(
    principal: Principal,
    input: Parameters<LicensingController["grantCredit"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "licensing:billing:manage");
    if (denied) return denied;
    return this.licensing.grantCredit(input);
  }
}
