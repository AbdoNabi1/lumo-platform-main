import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "../domain/checkout-session";
import { ContactEmail } from "../domain/value-objects/contact-email";
import { CheckoutSessionMapper, type CheckoutSessionRow } from "./checkout-session.mapper";

function guest(): CheckoutSession {
  return CheckoutSession.start(
    UniqueEntityId.from("00000000-0000-4000-8000-000000000001"),
    "cart-1",
    undefined,
    "session-1",
    "USD",
  );
}

function asRow(row: ReturnType<typeof CheckoutSessionMapper.toRow>): CheckoutSessionRow {
  return row as unknown as CheckoutSessionRow;
}

describe("CheckoutSessionMapper — contact email (WP-1)", () => {
  it("writes null when no contact email has been set", () => {
    expect(CheckoutSessionMapper.toRow(guest(), "t1").contactEmail).toBeNull();
  });

  it("round-trips a contact email", () => {
    const session = guest();
    const email = ContactEmail.create("Guest@Example.com");
    if (!email.ok) throw new Error("invalid fixture");
    session.setContactEmail(email.value);

    const row = CheckoutSessionMapper.toRow(session, "t1");
    expect(row.contactEmail).toBe("guest@example.com");
    expect(CheckoutSessionMapper.toDomain(asRow(row)).contactEmail?.value).toBe(
      "guest@example.com",
    );
  });

  it("reads a pre-migration row (contactEmail null) as unset", () => {
    const row = { ...asRow(CheckoutSessionMapper.toRow(guest(), "t1")), contactEmail: null };
    expect(CheckoutSessionMapper.toDomain(row).contactEmail).toBeUndefined();
  });
});
