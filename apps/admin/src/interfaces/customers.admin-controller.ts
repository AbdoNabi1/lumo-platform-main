import type { Principal } from "@platform/contracts";
import type { CustomerController } from "@platform/identity";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface CustomersAdminControllerDeps {
  readonly customers: CustomerController;
  readonly guard: AdminGuard;
}

/**
 * Wires the frozen **Customers** admin screen to the Identity context. Pure delegation —
 * register/addAddress/changeConsent. Every action authorizes the acting principal first (RBAC
 * seam, ADR-0007; permissive until real RBAC lands). (Segmentation + wishlist insights are later
 * concerns, not built.)
 */
export class CustomersAdminController {
  private readonly customers: CustomerController;
  private readonly guard: AdminGuard;

  constructor(deps: CustomersAdminControllerDeps) {
    this.customers = deps.customers;
    this.guard = deps.guard;
  }

  async registerCustomer(
    principal: Principal,
    input: Parameters<CustomerController["register"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:register");
    if (denied) return denied;
    return this.customers.register(input);
  }

  async addAddress(
    principal: Principal,
    input: Parameters<CustomerController["addAddress"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:add_address");
    if (denied) return denied;
    return this.customers.addAddress(input);
  }

  async changeConsent(
    principal: Principal,
    input: Parameters<CustomerController["changeConsent"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:change_consent");
    if (denied) return denied;
    return this.customers.changeConsent(input);
  }

  async getCustomer(
    principal: Principal,
    input: Parameters<CustomerController["getCustomer"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:read");
    if (denied) return denied;
    return this.customers.getCustomer(input);
  }

  /**
   * The names and emails of a set of customers in ONE read (Plan 3D) — what labels a page of orders
   * whose shipping address has no recipient name. Authorized as `orders:read`, not `customers:read`:
   * a staff member who may read orders must not see a list of anonymous rows because they lack the
   * separate customers screen's permission. Only name, email and the guest marker leave Identity.
   */
  async contactsOfCustomers(
    principal: Principal,
    input: Parameters<CustomerController["customerContacts"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:read");
    if (denied) return denied;
    return this.customers.customerContacts(input);
  }

  async listCustomers(
    principal: Principal,
    input: Parameters<CustomerController["listCustomers"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:read");
    if (denied) return denied;
    return this.customers.listCustomers(input);
  }
}
