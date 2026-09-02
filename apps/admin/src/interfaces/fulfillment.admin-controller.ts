import type { Principal } from "@platform/contracts";
import type { FulfillmentController } from "@platform/fulfillment";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface FulfillmentAdminControllerDeps {
  readonly fulfillment: FulfillmentController;
  readonly guard: AdminGuard;
}

/**
 * Wires the **Fulfillment** admin screen to the Fulfillment context (Sprint 4.9 — Fulfillment's
 * first admin wiring). Pure delegation over the 5 backoffice-relevant actions (create/advance
 * transitions/reserve/ship/record carrier webhook), per
 * `SPRINT_4_9_FULFILLMENT_CORE_REPORT.md` §2's "5 versioned zod routes". Every action authorizes
 * the acting principal first (RBAC seam, ADR-0007; permissive until real RBAC lands).
 */
export class FulfillmentAdminController {
  private readonly fulfillment: FulfillmentController;
  private readonly guard: AdminGuard;

  constructor(deps: FulfillmentAdminControllerDeps) {
    this.fulfillment = deps.fulfillment;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<FulfillmentController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "fulfillment:create");
    if (denied) return denied;
    return this.fulfillment.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<FulfillmentController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "fulfillment:advance");
    if (denied) return denied;
    return this.fulfillment.advance(input);
  }

  async reserve(
    principal: Principal,
    input: Parameters<FulfillmentController["reserve"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "fulfillment:reserve");
    if (denied) return denied;
    return this.fulfillment.reserve(input);
  }

  async ship(
    principal: Principal,
    input: Parameters<FulfillmentController["ship"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "fulfillment:ship");
    if (denied) return denied;
    return this.fulfillment.ship(input);
  }

  async getByOrder(
    principal: Principal,
    input: Parameters<FulfillmentController["getByOrder"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "fulfillment:read");
    if (denied) return denied;
    return this.fulfillment.getByOrder(input);
  }

  async recordWebhook(
    principal: Principal,
    input: Parameters<FulfillmentController["recordWebhook"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "fulfillment:record_webhook");
    if (denied) return denied;
    return this.fulfillment.recordWebhook(input);
  }
}
