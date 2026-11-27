import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { Customer } from "../domain/customer";
import { ConsentScope } from "../domain/value-objects/consent-scope";
import { Email } from "../domain/value-objects/email";
import { CustomerMapper } from "./customer.mapper";

describe("CustomerMapper consent source (Wave 2a)", () => {
  const email = Email.create("a@example.com");
  const scope = ConsentScope.create("marketing");
  if (!email.ok || !scope.ok) throw new Error("fixture");

  it("writes the source of a shopper's consent and reads it back; staff and old rows have none", () => {
    expect.hasAssertions();
    const customer = Customer.register(
      UniqueEntityId.from("00000000-0000-7000-8000-000000000001"),
      email.value,
      "A",
      "evt-1",
      new Date(0),
    );
    customer.changeConsent(
      UniqueEntityId.from("00000000-0000-7000-8000-000000000002"),
      scope.value,
      true,
      "evt-2",
      new Date(1),
      "shopper/checkout",
    );
    customer.changeConsent(
      UniqueEntityId.from("00000000-0000-7000-8000-000000000003"),
      scope.value,
      false,
      "evt-3",
      new Date(2),
    );

    const rows = CustomerMapper.toConsentRows(customer, "t1");

    expect(rows.map((row) => row.source)).toEqual(["shopper/checkout", null]);
    const back = CustomerMapper.toDomain(
      {
        id: customer.id.toString(),
        email: "a@example.com",
        name: "A",
        phone: null,
        language: null,
        isGuest: false,
        emailVerifiedAt: null,
        version: 1,
      },
      [],
      // A row written before the column existed has no `source` key at all.
      [rows[0]!, { id: rows[1]!.id, scope: "marketing", granted: false, occurredAt: new Date(2) }],
    );
    expect(back.consents.map((record) => record.source)).toEqual(["shopper/checkout", undefined]);
  });
});
