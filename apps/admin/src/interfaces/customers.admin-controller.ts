import type { Principal } from "@platform/contracts";
import type { Customer, CustomerController } from "@platform/identity";
import type { Paginated } from "@platform/types";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface CustomersAdminControllerDeps {
  readonly customers: CustomerController;
  readonly guard: AdminGuard;
}

type PageInfo = Paginated<Customer>["pageInfo"];

/** One row of {@link CustomersAdminController.exportCustomers}: the customer plus their note and tags. */
export interface CustomerExportItem {
  readonly customer: Customer;
  readonly note: string | null;
  readonly tags: readonly string[];
}

export interface CustomerExportPage {
  readonly items: readonly CustomerExportItem[];
  readonly pageInfo: PageInfo;
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

  /** Staff-created customer (Wave 1b) — `customers:register`, like the shopper-facing register. */
  async createCustomer(
    principal: Principal,
    input: Parameters<CustomerController["createCustomer"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:register");
    if (denied) return denied;
    return this.customers.createCustomer(input);
  }

  async updateCustomerProfile(
    principal: Principal,
    input: Parameters<CustomerController["updateCustomerProfile"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:update");
    if (denied) return denied;
    return this.customers.updateCustomerProfile(input);
  }

  async setCustomerNote(
    principal: Principal,
    input: Parameters<CustomerController["setCustomerNote"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:update");
    if (denied) return denied;
    return this.customers.setCustomerNote(input);
  }

  async setCustomerTags(
    principal: Principal,
    input: Parameters<CustomerController["setCustomerTags"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:update");
    if (denied) return denied;
    return this.customers.setCustomerTags(input);
  }

  async changeMarketingConsent(
    principal: Principal,
    input: Parameters<CustomerController["changeMarketingConsent"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:change_consent");
    if (denied) return denied;
    return this.customers.changeMarketingConsent(input);
  }

  async customerAnnotations(
    principal: Principal,
    input: Parameters<CustomerController["customerAnnotations"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:read");
    if (denied) return denied;
    return this.customers.customerAnnotations(input);
  }

  /**
   * One page of customers WITH their notes and tags, for the CSV export. Guarded as
   * `customers:export` (a viewer may read customers but not bulk-export their personal data).
   * A failed list or a failed annotations read is answered as is — never partial rows.
   */
  async exportCustomers(
    principal: Principal,
    input: Parameters<CustomerController["listCustomers"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customers:export");
    if (denied) return denied;
    const listed = await this.customers.listCustomers(input);
    if (listed.status !== 200) return listed;
    const page = listed.body as { items: readonly Customer[]; pageInfo: PageInfo };
    if (page.items.length === 0) {
      return {
        status: 200,
        body: { items: [], pageInfo: page.pageInfo } satisfies CustomerExportPage,
      };
    }
    const annotated = await this.customers.customerAnnotations({
      tenantId: input.tenantId,
      customerIds: page.items.map((customer) => customer.id.toString()),
    });
    if (annotated.status !== 200) return annotated;
    const byId = new Map(
      (
        annotated.body as {
          items: readonly { customerId: string; note: string | null; tags: readonly string[] }[];
        }
      ).items.map((item) => [item.customerId, item]),
    );
    const body: CustomerExportPage = {
      items: page.items.map((customer) => {
        const found = byId.get(customer.id.toString());
        return { customer, note: found?.note ?? null, tags: found?.tags ?? [] };
      }),
      pageInfo: page.pageInfo,
    };
    return { status: 200, body };
  }
}
