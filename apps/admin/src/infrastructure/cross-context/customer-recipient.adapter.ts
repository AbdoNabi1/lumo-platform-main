import type { CustomerController } from "@platform/identity";
import type { RecipientContact, RecipientResolverPort } from "@platform/notifications";

interface CustomerLike {
  readonly name: string;
  readonly email: { readonly value: string };
  readonly language: string | null;
}

/**
 * Wave 2b: resolves a notification's bare `customerRef` to the customer's name, address and language
 * AT SEND TIME, through Identity's own customer read. The address is never stored on a notification
 * (ADR-0006). A ref that is not a customer (or an erased one) resolves to nobody.
 */
export class CustomerRecipientResolver implements RecipientResolverPort {
  private readonly customers: Pick<CustomerController, "getCustomer">;

  constructor(customers: Pick<CustomerController, "getCustomer">) {
    this.customers = customers;
  }

  async resolve(tenantId: string, customerRef: string): Promise<RecipientContact | null> {
    let response;
    try {
      response = await this.customers.getCustomer({ tenantId, customerId: customerRef });
    } catch {
      // A reference that is not an id (legacy / back-office refs are free text) is simply nobody.
      return null;
    }
    if (response.status !== 200) return null;
    const customer = response.body as CustomerLike;
    return {
      name: customer.name,
      email: customer.email.value,
      language: customer.language,
    };
  }
}
