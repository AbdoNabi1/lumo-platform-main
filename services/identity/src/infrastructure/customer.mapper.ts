import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { Address } from "../domain/address";
import { ConsentRecord } from "../domain/consent-record";
import { Customer } from "../domain/customer";
import { ConsentScope } from "../domain/value-objects/consent-scope";
import { Email } from "../domain/value-objects/email";

export interface CustomerRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly isGuest: boolean;
  readonly emailVerifiedAt: Date | null;
  readonly version: number;
}
export interface AddressRow {
  readonly id: string;
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}
export interface ConsentRow {
  readonly id: string;
  readonly scope: string;
  readonly granted: boolean;
  readonly occurredAt: Date;
}

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(`Corrupt identity row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

/**
 * Persistence ↔ aggregate mapping for {@link Customer}. Mapping only — no I/O. Consent rows must
 * arrive in occurrence order (the log is append-only; state derives from the latest per scope).
 */
export class CustomerMapper {
  static toDomain(
    row: CustomerRow,
    addresses: readonly AddressRow[],
    consents: readonly ConsentRow[],
  ): Customer {
    return Customer.reconstitute(
      UniqueEntityId.from(row.id),
      must(Email.create(row.email), "email"),
      row.name,
      addresses.map((a) =>
        must(
          Address.create(UniqueEntityId.from(a.id), a.line1, a.city, a.postalCode, a.country),
          "address",
        ),
      ),
      consents.map((c) =>
        ConsentRecord.create(
          UniqueEntityId.from(c.id),
          must(ConsentScope.create(c.scope), "consent scope"),
          c.granted,
          c.occurredAt,
        ),
      ),
      row.version,
      row.isGuest,
      row.emailVerifiedAt,
    );
  }

  static toCustomerRow(customer: Customer, tenantId: string) {
    return {
      id: customer.id.toString(),
      tenantId,
      email: customer.email.value,
      name: customer.name,
      isGuest: customer.isGuest,
      emailVerifiedAt: customer.emailVerifiedAt,
      version: 1,
    };
  }

  static toAddressRows(customer: Customer, tenantId: string) {
    return customer.addresses.map((a) => ({
      id: a.id.toString(),
      tenantId,
      customerId: customer.id.toString(),
      line1: a.line1,
      city: a.city,
      postalCode: a.postalCode,
      country: a.country,
    }));
  }

  /** Full append-only log; insertion uses `skipDuplicates` so persisted entries are no-ops. */
  static toConsentRows(customer: Customer, tenantId: string) {
    return customer.consents.map((c) => ({
      id: c.id.toString(),
      tenantId,
      customerId: customer.id.toString(),
      scope: c.scope.value,
      granted: c.granted,
      occurredAt: c.occurredAt,
    }));
  }
}
