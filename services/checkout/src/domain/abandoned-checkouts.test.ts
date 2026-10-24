import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import {
  abandonedBefore,
  ABANDONED_PAGE_SIZE_MAX,
  clampAbandonedPageSize,
  isAbandonedCheckout,
  matchesAbandonedSearch,
  normalizeAbandonedSearch,
} from "./abandoned-checkouts";
import { CheckoutSession } from "./checkout-session";
import { CheckoutAddress } from "./value-objects/checkout-address";
import { CheckoutItem } from "./value-objects/checkout-item";
import { ContactEmail } from "./value-objects/contact-email";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

const NOW = new Date("2026-10-18T12:00:00.000Z");
const OLDER_THAN = abandonedBefore(NOW);
const IDLE = new Date("2026-10-18T10:59:59.999Z");
const JUST_NOW = new Date("2026-10-18T11:00:00.000Z");

function session(
  options: { email?: string; phone?: string; name?: string; items?: boolean } = {},
): CheckoutSession {
  const s = CheckoutSession.start(UniqueEntityId.from("cs-1"), "cart-1", undefined, "ref-1", "EGP");
  if (options.items !== false) s.loadItems([must(CheckoutItem.create("p-1", 1, 1000, "EGP"))]);
  if (options.email !== undefined) s.setContactEmail(must(ContactEmail.create(options.email)));
  if (options.phone !== undefined || options.name !== undefined) {
    s.setShippingAddress(
      must(
        CheckoutAddress.create({
          name: options.name,
          phone: options.phone,
          line1: "5 Nile St",
          city: "Cairo",
          postalCode: "",
          country: "EG",
        }),
      ),
    );
  }
  return s;
}

const record = (s: CheckoutSession, updatedAt = IDLE) => ({
  session: s,
  createdAt: updatedAt,
  updatedAt,
});

describe("isAbandonedCheckout (spec §3.1)", () => {
  it("the threshold is 60 minutes before now", () => {
    expect(OLDER_THAN).toEqual(new Date("2026-10-18T11:00:00.000Z"));
  });

  it("open, idle an hour, with items and an email or a phone", () => {
    expect(isAbandonedCheckout(record(session({ email: "a@b.co" })), OLDER_THAN)).toBe(true);
    expect(isAbandonedCheckout(record(session({ phone: "01001234567" })), OLDER_THAN)).toBe(true);
    const locked = session({ email: "a@b.co" });
    locked.lock("e", NOW);
    expect(isAbandonedCheckout(record(locked), OLDER_THAN)).toBe(true);
  });

  it("not while the shopper may still be typing (idle exactly 60 minutes is not yet)", () => {
    expect(isAbandonedCheckout(record(session({ email: "a@b.co" }), JUST_NOW), OLDER_THAN)).toBe(
      false,
    );
  });

  it("not without items, without any contact, or once completed / failed / expired", () => {
    expect(
      isAbandonedCheckout(record(session({ email: "a@b.co", items: false })), OLDER_THAN),
    ).toBe(false);
    expect(isAbandonedCheckout(record(session({ name: "No Phone" })), OLDER_THAN)).toBe(false);
    for (const end of ["complete", "fail", "expire"] as const) {
      const s = session({ email: "a@b.co" });
      if (end === "complete") s.complete("o-1", "e", NOW);
      if (end === "fail") s.fail("declined", "e", NOW);
      if (end === "expire") s.expire("e", NOW);
      expect(isAbandonedCheckout(record(s), OLDER_THAN), end).toBe(false);
    }
  });

  it("a recovered checkout stays listed, however fresh or closed", () => {
    const s = session({ email: "a@b.co" });
    s.markRecovered("order-9", "e", NOW);
    expect(isAbandonedCheckout(record(s, NOW), OLDER_THAN)).toBe(true);
  });
});

describe("search and page size", () => {
  it("normalizes the search: trimmed, blank is none, capped at 100 characters", () => {
    expect(normalizeAbandonedSearch(undefined)).toBeUndefined();
    expect(normalizeAbandonedSearch("   ")).toBeUndefined();
    expect(normalizeAbandonedSearch("  mona ")).toBe("mona");
    expect(normalizeAbandonedSearch("x".repeat(150))).toHaveLength(100);
  });

  it("matches the email, the recipient's name and the phone, case-insensitively and literally", () => {
    const s = session({ email: "Sara@Example.com", phone: "01001234567", name: "Mona Ali" });
    expect(matchesAbandonedSearch(s, "SARA@")).toBe(true);
    expect(matchesAbandonedSearch(s, "mona")).toBe(true);
    expect(matchesAbandonedSearch(s, "0100123")).toBe(true);
    expect(matchesAbandonedSearch(s, "%")).toBe(false);
    expect(matchesAbandonedSearch(s, "ahmed")).toBe(false);
  });

  it("clamps the page size to 1..50, default 50", () => {
    expect(clampAbandonedPageSize(undefined)).toBe(ABANDONED_PAGE_SIZE_MAX);
    expect(clampAbandonedPageSize(0)).toBe(1);
    expect(clampAbandonedPageSize(500)).toBe(50);
    expect(clampAbandonedPageSize(20.7)).toBe(20);
    expect(clampAbandonedPageSize(Number.NaN)).toBe(50);
  });
});
