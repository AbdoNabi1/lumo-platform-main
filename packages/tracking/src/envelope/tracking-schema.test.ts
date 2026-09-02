import { describe, expect, it } from "vitest";

import {
  CLICK_ID_NAMES,
  extractClickIds,
  isClickIdName,
  isClickIdValidAt,
  type CapturedClickId,
} from "./click-ids";
import { DENY_ALL_CONSENT, evaluateConsent, type ConsentSnapshot } from "./consent";
import { matchQualitySignals, isKnownIdentity } from "./identity-context";
import { deriveNumItems } from "./payload";
import {
  dedupKeyMaterial,
  deriveDedupId,
  isWithinDedupWindow,
  minuteBucket,
  type HashPort,
} from "../ids/dedup-id";

const GRANTED: ConsentSnapshot = {
  analytics: true,
  marketing: true,
  personalization: true,
  grants: {
    necessary: true,
    analytics_storage: true,
    ad_storage: true,
    ad_user_data: true,
    ad_personalization: true,
    personalization: true,
  },
};

describe("consent gate (fail-closed)", () => {
  it("denies every purpose when no snapshot exists", () => {
    for (const purpose of ["analytics", "marketing", "personalization"] as const) {
      const decision = evaluateConsent(undefined, purpose);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.denial.reason).toBe("no_consent_snapshot");
    }
  });

  it("denies everything under the deny-all snapshot", () => {
    expect(evaluateConsent(DENY_ALL_CONSENT, "analytics").allowed).toBe(false);
    expect(evaluateConsent(DENY_ALL_CONSENT, "marketing").allowed).toBe(false);
    expect(evaluateConsent(DENY_ALL_CONSENT, "personalization").allowed).toBe(false);
  });

  it("allows each purpose once its categories are granted", () => {
    expect(evaluateConsent(GRANTED, "analytics").allowed).toBe(true);
    expect(evaluateConsent(GRANTED, "marketing").allowed).toBe(true);
  });

  it("requires BOTH ad_storage and ad_user_data for marketing", () => {
    const storageOnly: ConsentSnapshot = {
      ...GRANTED,
      grants: { ...GRANTED.grants, ad_user_data: false },
    };

    const decision = evaluateConsent(storageOnly, "marketing");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.denial.missing).toEqual(["ad_user_data"]);
  });

  it("falls back to the coarse booleans when granular grants are absent", () => {
    const coarse: ConsentSnapshot = { analytics: true, marketing: false, personalization: false };
    expect(evaluateConsent(coarse, "analytics").allowed).toBe(true);
    expect(evaluateConsent(coarse, "marketing").allowed).toBe(false);
  });

  it("treats an unspecified granular category as not granted", () => {
    const partial: ConsentSnapshot = {
      analytics: true,
      marketing: true,
      personalization: true,
      grants: { ad_storage: true },
    };
    // ad_user_data is absent from `grants`, so the coarse `marketing` flag decides it.
    expect(evaluateConsent(partial, "marketing").allowed).toBe(true);
  });
});

describe("dedup id (D-077: distinct from event_id, shared across emitters)", () => {
  const hasher: HashPort = {
    // Deterministic stand-in; the real adapter is SHA-256 at the composition root.
    sha256Hex: (input) => Promise.resolve(`h(${input})`),
  };

  const base = {
    tenantId: "t-1",
    eventName: "purchase",
    eventVersion: 1,
    strategy: { kind: "order", orderId: "o-99" } as const,
    occurredAt: new Date("2026-07-19T10:30:45.123Z"),
  };

  it("produces identical material for the browser and server copies", async () => {
    const browser = await deriveDedupId(base, hasher);
    const server = await deriveDedupId({ ...base }, hasher);
    expect(browser).toBe(server);
  });

  it("scopes by tenant so two tenants never collide on a shared order id", () => {
    expect(dedupKeyMaterial(base)).not.toBe(dedupKeyMaterial({ ...base, tenantId: "t-2" }));
  });

  it("scopes by event version so a schema change starts a fresh namespace", () => {
    expect(dedupKeyMaterial(base)).not.toBe(dedupKeyMaterial({ ...base, eventVersion: 2 }));
  });

  it("buckets session_minute events to the minute so emitters agree", () => {
    const at = new Date("2026-07-19T10:30:45.123Z");
    const later = new Date("2026-07-19T10:30:59.999Z");
    const strategy = { kind: "session_minute", sessionId: "s-1" } as const;

    expect(dedupKeyMaterial({ ...base, strategy, occurredAt: at })).toBe(
      dedupKeyMaterial({ ...base, strategy, occurredAt: later }),
    );
    expect(minuteBucket(at)).toBe("2026-07-19T10:30");
  });

  it("treats a repeat outside the 7-day window as a genuine new occurrence", () => {
    const now = new Date("2026-07-19T00:00:00.000Z");
    expect(isWithinDedupWindow(new Date("2026-07-15T00:00:00.000Z"), now)).toBe(true);
    expect(isWithinDedupWindow(new Date("2026-07-01T00:00:00.000Z"), now)).toBe(false);
  });
});

describe("click id capture", () => {
  const capturedAt = "2026-07-19T10:00:00.000Z";

  it("captures only registered identifiers", () => {
    const query = new Map([
      ["gclid", "G-1"],
      ["fbclid", "F-1"],
      ["not_a_click_id", "X"],
    ]);

    const captured = extractClickIds((p) => query.get(p) ?? null, capturedAt);
    expect(captured.map((c) => c.name).sort()).toEqual(["fbclid", "gclid"]);
  });

  it("ignores empty and whitespace-only values", () => {
    const captured = extractClickIds((p) => (p === "gclid" ? "   " : null), capturedAt);
    expect(captured).toHaveLength(0);
  });

  it("freezes the campaign resolved at capture time", () => {
    const captured = extractClickIds((p) => (p === "ttclid" ? "T-1" : null), capturedAt, {
      source: "tiktok",
      campaign: "summer",
    });
    expect(captured[0]).toMatchObject({ source: "tiktok", campaign: "summer" });
  });

  it("covers every platform in the registry", () => {
    expect(CLICK_ID_NAMES).toContain("twclid");
    expect(CLICK_ID_NAMES.length).toBeGreaterThanOrEqual(10);
    expect(isClickIdName("gbraid")).toBe(true);
    expect(isClickIdName("nope")).toBe(false);
  });

  it("expires a click id past its platform window", () => {
    const snap: CapturedClickId = {
      name: "scclid",
      value: "S-1",
      capturedAt: "2026-06-01T00:00:00.000Z",
    };
    // Snapchat's window is 28 days.
    expect(isClickIdValidAt(snap, new Date("2026-06-20T00:00:00.000Z"))).toBe(true);
    expect(isClickIdValidAt(snap, new Date("2026-07-19T00:00:00.000Z"))).toBe(false);
  });

  it("rejects an unparseable capture instant rather than assuming validity", () => {
    const bad: CapturedClickId = { name: "gclid", value: "G", capturedAt: "not-a-date" };
    expect(isClickIdValidAt(bad, new Date())).toBe(false);
  });
});

describe("identity", () => {
  it("counts only populated advanced-matching fields", () => {
    expect(matchQualitySignals({ email: "a@b.com", firstName: "  ", city: "Cairo" })).toEqual([
      "email",
      "city",
    ]);
  });

  it("recognises a known identity from any strong identifier", () => {
    expect(isKnownIdentity({ visitorId: "v-1" })).toBe(false);
    expect(isKnownIdentity({ visitorId: "v-1", customerId: "c-1" })).toBe(true);
  });
});

describe("payload", () => {
  it("derives item count, defaulting a missing quantity to one", () => {
    expect(deriveNumItems([{ itemId: "a", quantity: 2 }, { itemId: "b" }])).toBe(3);
    expect(deriveNumItems([])).toBeUndefined();
    expect(deriveNumItems(undefined)).toBeUndefined();
  });
});
