import { describe, expect, it } from "vitest";
import {
  abandonedTimeline,
  canRecoverCheckout,
  parseRecoveryFilter,
  placedByLabel,
  recoveryLinkHref,
} from "./abandoned-checkouts";

describe("abandoned checkouts view logic (order operations Part 3)", () => {
  it("only operators and admins may send recovery links", () => {
    expect(canRecoverCheckout("admin")).toBe(true);
    expect(canRecoverCheckout("operator")).toBe(true);
    expect(canRecoverCheckout("viewer")).toBe(false);
    expect(canRecoverCheckout(undefined)).toBe(false);
  });

  it("reads the recovery filter from the URL, ignoring anything else", () => {
    expect(parseRecoveryFilter("recovered")).toBe("recovered");
    expect(parseRecoveryFilter("not_recovered")).toBe("not_recovered");
    expect(parseRecoveryFilter("all")).toBeUndefined();
    expect(parseRecoveryFilter(undefined)).toBeUndefined();
  });

  it("'Placed by' is the recipient's name, else the email, else the phone", () => {
    expect(placedByLabel({ customerName: "Mona", email: "m@x.co", phone: "010" })).toBe("Mona");
    expect(placedByLabel({ customerName: null, email: "m@x.co", phone: "010" })).toBe("m@x.co");
    expect(placedByLabel({ customerName: null, email: null, phone: "010" })).toBe("010");
    expect(placedByLabel({ customerName: null, email: null, phone: null })).toBeNull();
  });

  it("the link is the API's URL, else STOREFRONT_URL + path, else none", () => {
    expect(
      recoveryLinkHref({ url: "https://www.sara.shop/c/t", path: "/c/t" }, "https://x.test"),
    ).toBe("https://www.sara.shop/c/t");
    expect(recoveryLinkHref({ url: null, path: "/c/t" }, "https://shop.example/")).toBe(
      "https://shop.example/c/t",
    );
    expect(recoveryLinkHref({ url: null, path: "/c/t" }, "  ")).toBeNull();
    expect(recoveryLinkHref({ url: null, path: "/c/t" }, null)).toBeNull();
  });

  it("the timeline is newest first, with the recovery on top", () => {
    const events = abandonedTimeline({
      createdAt: "2026-10-18T09:00:00.000Z",
      lastActivityAt: "2026-10-18T09:20:00.000Z",
      links: [
        {
          issuedAt: "2026-10-18T12:00:00.000Z",
          expiresAt: "x",
          claimCount: 2,
          lastClaimedAt: "2026-10-18T13:00:00.000Z",
        },
        {
          issuedAt: "2026-10-18T11:00:00.000Z",
          expiresAt: "x",
          claimCount: 0,
          lastClaimedAt: null,
        },
      ],
      recoveredOrder: { id: "order-9", orderNumber: "1007" },
    });
    expect(events.map((event) => [event.kind, event.at])).toEqual([
      ["recovered", null],
      ["link_opened", "2026-10-18T13:00:00.000Z"],
      ["link_issued", "2026-10-18T12:00:00.000Z"],
      ["link_issued", "2026-10-18T11:00:00.000Z"],
      ["last_activity", "2026-10-18T09:20:00.000Z"],
      ["started", "2026-10-18T09:00:00.000Z"],
    ]);
    expect(events[1]?.count).toBe(2);
    expect(events[0]?.orderNumber).toBe("1007");
  });

  it("no separate 'last activity' when nothing happened after the start", () => {
    const events = abandonedTimeline({
      createdAt: "2026-10-18T09:00:00.000Z",
      lastActivityAt: "2026-10-18T09:00:00.000Z",
      links: [],
      recoveredOrder: null,
    });
    expect(events.map((event) => event.kind)).toEqual(["started"]);
  });
});
