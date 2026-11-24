import { beforeEach, describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import {
  customerCountLabel,
  decodeSegmentId,
  isSegmentsUnavailable,
  segmentDisplayName,
  segmentHref,
} from "./segment-labels";

beforeEach(() => {
  expect.hasAssertions();
});

describe("segmentDisplayName", () => {
  it("shows a custom segment's own name and a default segment's localized label", () => {
    const custom = { id: "s-1", kind: "custom", key: null, name: "VIP" } as const;
    const standard = {
      id: "default:email_subscribers",
      kind: "default",
      key: "emailSubscribers",
      name: null,
    } as const;

    expect(segmentDisplayName(custom, en)).toBe("VIP");
    expect(segmentDisplayName(custom, ar)).toBe("VIP");
    expect(segmentDisplayName(standard, en)).toBe("Email subscribers");
    expect(segmentDisplayName(standard, ar)).toBe(ar.segments.defaults.emailSubscribers);
  });

  it("falls back to the key, then the id, for a default this build does not know", () => {
    expect(
      segmentDisplayName({ id: "default:x", kind: "default", key: "futureKey", name: null }, en),
    ).toBe("futureKey");
    expect(
      segmentDisplayName({ id: "default:x", kind: "default", key: null, name: null }, en),
    ).toBe("default:x");
  });
});

describe("customerCountLabel", () => {
  it("uses the locale's plural forms", () => {
    expect(customerCountLabel(0, "en", en)).toBe("0 customers");
    expect(customerCountLabel(1, "en", en)).toBe("1 customer");
    expect(customerCountLabel(1234, "en", en)).toBe("1,234 customers");
    expect(customerCountLabel(1, "ar", ar)).toBe(ar.segments.customerCount.one);
    expect(customerCountLabel(2, "ar", ar)).toBe(ar.segments.customerCount.two);
    expect(customerCountLabel(0, "ar", ar)).toBe(ar.segments.customerCount.zero);
  });
});

describe("segment ids in URLs", () => {
  it("encodes for links and decodes what the router hands over", () => {
    expect(segmentHref("default:not_purchased")).toBe(
      "/customers/segments/default%3Anot_purchased",
    );
    expect(decodeSegmentId("default%3Anot_purchased")).toBe("default:not_purchased");
    expect(decodeSegmentId("default:not_purchased")).toBe("default:not_purchased");
    expect(decodeSegmentId("%E0%A4%A")).toBe("%E0%A4%A");
  });
});

describe("isSegmentsUnavailable", () => {
  it("is true only for status 503 with the UNAVAILABLE code", () => {
    expect(isSegmentsUnavailable({ status: 503, code: "UNAVAILABLE" })).toBe(true);
    expect(isSegmentsUnavailable({ status: 503 })).toBe(false);
    expect(isSegmentsUnavailable({ status: 500, code: "UNAVAILABLE" })).toBe(false);
    expect(isSegmentsUnavailable({ code: "UNAVAILABLE" })).toBe(false);
    expect(isSegmentsUnavailable({})).toBe(false);
  });
});
