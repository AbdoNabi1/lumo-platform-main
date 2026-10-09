import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
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

describe("CheckoutSessionMapper — variant lines (Plan 2A)", () => {
  function sessionWithItems(): CheckoutSession {
    const session = guest();
    const variantLine = CheckoutItem.create("p-shirt", 2, 12000, "EGP", {
      variantRef: "v-l",
      sku: "SHIRT-L",
      title: "Shirt",
      variantTitle: "L",
    });
    const legacyLine = CheckoutItem.create("p-mug", 1, 5000, "EGP");
    if (!variantLine.ok || !legacyLine.ok) throw new Error("invalid fixture");
    session.loadItems([variantLine.value, legacyLine.value]);
    return session;
  }

  it("round-trips a variant line with all four fields, and a legacy line unchanged", () => {
    const row = asRow(CheckoutSessionMapper.toRow(sessionWithItems(), "t1"));
    const back = CheckoutSessionMapper.toDomain(row);

    expect(
      back.items.map((i) => [i.productRef, i.variantRef, i.sku, i.title, i.variantTitle]),
    ).toEqual([
      ["p-shirt", "v-l", "SHIRT-L", "Shirt", "L"],
      ["p-mug", undefined, undefined, undefined, undefined],
    ]);
  });

  it("writes no variant keys into a legacy line's stored JSON", () => {
    const row = CheckoutSessionMapper.toRow(sessionWithItems(), "t1");
    expect(row.items[1]).toEqual({
      productRef: "p-mug",
      quantity: 1,
      unitPriceAmountMinor: 5000,
      currency: "EGP",
    });
  });

  it("reads a stored line written before the keys existed as a legacy line", () => {
    const row = {
      ...asRow(CheckoutSessionMapper.toRow(guest(), "t1")),
      items: [{ productRef: "p-old", quantity: 1, unitPriceAmountMinor: 100, currency: "EGP" }],
    };
    const line = CheckoutSessionMapper.toDomain(row).items[0];
    expect(line?.variantRef).toBeUndefined();
    expect(line?.title).toBeUndefined();
  });
});

describe("CheckoutSessionMapper — recipient name and phone (Plan 3A)", () => {
  function sessionWithShipping(extra: { name?: string; phone?: string }): CheckoutSession {
    const session = guest();
    const address = CheckoutAddress.create({
      line1: "1 Main St",
      city: "Cairo",
      postalCode: "",
      country: "EG",
      ...extra,
    });
    if (!address.ok) throw new Error("invalid fixture");
    session.setShippingAddress(address.value);
    return session;
  }

  it("round-trips the name, phone and an empty postal code through the stored JSON", () => {
    const row = asRow(
      CheckoutSessionMapper.toRow(
        sessionWithShipping({ name: "Mona Ali", phone: "+201012345678" }),
        "t1",
      ),
    );
    expect(row.shippingAddress).toMatchObject({ name: "Mona Ali", phone: "+201012345678" });

    const back = CheckoutSessionMapper.toDomain(row).shippingAddress;
    expect(back?.name).toBe("Mona Ali");
    expect(back?.phone).toBe("+201012345678");
    expect(back?.postalCode).toBe("");
  });

  it("reads a stored address written before the keys existed with neither", () => {
    const row = {
      ...asRow(CheckoutSessionMapper.toRow(guest(), "t1")),
      shippingAddress: { line1: "1 Main St", city: "Cairo", postalCode: "11511", country: "EG" },
    };
    const back = CheckoutSessionMapper.toDomain(row).shippingAddress;
    expect(back?.name).toBeUndefined();
    expect(back?.phone).toBeUndefined();
    expect(back?.line1).toBe("1 Main St");
  });
});
