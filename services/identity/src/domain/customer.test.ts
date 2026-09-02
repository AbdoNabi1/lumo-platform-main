import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { Address } from "./address";
import { Customer } from "./customer";
import { ConsentScope } from "./value-objects/consent-scope";
import { Email } from "./value-objects/email";

function email(value = "alice@example.com"): Email {
  const result = Email.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function scope(value: string): ConsentScope {
  const result = ConsentScope.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function customer(): Customer {
  return Customer.register(UniqueEntityId.from("cust-1"), email(), "Alice", "evt-reg", new Date(0));
}

describe("Customer", () => {
  it("registers and emits customer.registered", () => {
    const c = customer();
    const events = c.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("customer.registered");
  });

  it("adds addresses", () => {
    const c = customer();
    const address = Address.create(
      UniqueEntityId.from("addr-1"),
      "1 Main St",
      "Town",
      "12345",
      "US",
    );
    if (!address.ok) throw new Error("invalid fixture");
    c.addAddress(address.value);
    expect(c.addresses).toHaveLength(1);
  });

  it("derives consent from the latest record and emits consent.changed", () => {
    const c = customer();
    c.pullDomainEvents();

    expect(c.consentFor(scope("marketing"))).toBe(false);
    c.changeConsent(UniqueEntityId.from("con-1"), scope("marketing"), true, "evt-1", new Date(0));
    expect(c.consentFor(scope("marketing"))).toBe(true);
    expect(c.pullDomainEvents()[0]?.eventName).toBe("consent.changed");

    c.changeConsent(UniqueEntityId.from("con-2"), scope("marketing"), false, "evt-2", new Date(0));
    expect(c.consentFor(scope("marketing"))).toBe(false);
  });
});
