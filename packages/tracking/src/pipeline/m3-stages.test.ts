import { describe, expect, it } from "vitest";

import { resolveChannel } from "./channel-resolver";
import { enrichAttribution, mergeClickIds } from "./enrichment";
import {
  DETERMINISTIC_FLOOR,
  EMPTY_IDENTITY_GRAPH,
  PROBABILISTIC_CEILING,
  addEdge,
  classifyEdge,
  resolveIdentity,
  scoreConfidence,
  stitchFromIdentifiers,
} from "./identity-graph";
import { assignCredit, computeAttribution, creditsAreNormalized } from "./attribution";
import {
  DoubleHashError,
  HASHED_FIELDS,
  PIPELINE_STAGES,
  hashIdentity,
  isForwardable,
  stagePrecedes,
} from "./hashing";
import { normalizeIdentity } from "./normalization";
import type { CapturedClickId } from "../envelope/click-ids";
import type { Touchpoint } from "../envelope/attribution-context";
import type { HashPort } from "../ids/dedup-id";

const NOW = new Date("2026-07-19T12:00:00.000Z");

describe("channel resolution", () => {
  it("treats a click id as proof of paid, outranking a declared medium", () => {
    expect(resolveChannel({ clickIds: ["gclid"], utmMedium: "organic" })).toMatchObject({
      channelGroup: "paid_search",
      basis: "click_id",
    });
    expect(resolveChannel({ clickIds: ["fbclid"] }).channelGroup).toBe("paid_social");
  });

  it("distinguishes paid search from paid social by source", () => {
    expect(resolveChannel({ utmMedium: "cpc", utmSource: "google" }).channelGroup).toBe(
      "paid_search",
    );
    expect(resolveChannel({ utmMedium: "cpc", utmSource: "facebook.com" }).channelGroup).toBe(
      "paid_social",
    );
  });

  it("classifies the extended channel set", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["email", "email"],
      ["sms", "sms"],
      ["push", "push"],
      ["affiliate", "affiliate"],
      ["influencer", "influencer"],
      ["marketplace", "marketplace"],
      ["offline", "offline"],
      ["display", "display"],
    ];
    for (const [medium, expected] of cases) {
      expect(resolveChannel({ utmMedium: medium }).channelGroup).toBe(expected);
    }
  });

  it("infers organic search and social from the referrer", () => {
    expect(resolveChannel({ referrer: "https://www.google.com/search?q=x" }).channelGroup).toBe(
      "organic_search",
    );
    expect(resolveChannel({ referrer: "https://m.facebook.com/x" }).channelGroup).toBe(
      "organic_social",
    );
    expect(resolveChannel({ referrer: "https://someblog.dev/post" }).channelGroup).toBe("referral");
  });

  it("classifies our own hosts as internal, not as an acquisition", () => {
    expect(
      resolveChannel({ referrer: "https://shop.example.com/x", selfHosts: ["example.com"] }),
    ).toMatchObject({ channelGroup: "internal", basis: "internal" });
  });

  it("reports unknown rather than assuming direct when signals are unclassifiable", () => {
    // Mislabelling paid traffic as direct silently overstates organic performance.
    expect(resolveChannel({ utmMedium: "mystery-medium" })).toMatchObject({
      channelGroup: "unknown",
      basis: "insufficient_signal",
    });
    expect(resolveChannel({}).channelGroup).toBe("direct");
  });
});

describe("enrichment — click id preservation", () => {
  const gclid: CapturedClickId = {
    name: "gclid",
    value: "G-1",
    capturedAt: "2026-07-18T12:00:00.000Z",
  };

  it("preserves a stored click id through an event that carries none", () => {
    // The classic mid-funnel failure: a page view with no click id collapsing attribution.
    expect(mergeClickIds([gclid], [], NOW)).toEqual([gclid]);
    expect(mergeClickIds([gclid], undefined, NOW)).toEqual([gclid]);
  });

  it("lets a fresh observation replace a stored one for the same platform", () => {
    const fresh: CapturedClickId = { ...gclid, value: "G-2", capturedAt: NOW.toISOString() };
    expect(mergeClickIds([gclid], [fresh], NOW)).toEqual([fresh]);
  });

  it("drops click ids that have aged out of their window", () => {
    const expired: CapturedClickId = {
      name: "scclid",
      value: "S-1",
      capturedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(mergeClickIds([expired], [], NOW)).toEqual([]);
  });

  it("accumulates click ids across platforms", () => {
    const fbclid: CapturedClickId = { name: "fbclid", value: "F-1", capturedAt: NOW.toISOString() };
    expect(mergeClickIds([gclid], [fbclid], NOW)).toHaveLength(2);
  });

  it("fills gaps from persisted state without overriding an asserted value", () => {
    const enriched = enrichAttribution({
      context: { attribution: { utmSource: "explicit" } },
      persisted: { utmSource: "stored", utmCampaign: "spring", landingPage: "/land" },
      now: NOW,
    });

    expect(enriched.utmSource).toBe("explicit");
    expect(enriched.utmCampaign).toBe("spring");
    expect(enriched.landingPage).toBe("/land");
  });

  it("stamps the resolved channel onto the event", () => {
    const enriched = enrichAttribution({
      context: {},
      persisted: { clickIds: [gclid] },
      now: NOW,
    });
    expect(enriched.channelGroup).toBe("paid_search");
    expect(enriched.clickIds).toHaveLength(1);
  });
});

describe("identity graph — append-only and immutable", () => {
  const observedAt = NOW.toISOString();

  it("never mutates the input graph", () => {
    const graph = stitchFromIdentifiers(EMPTY_IDENTITY_GRAPH, {
      visitorId: "v-1",
      identifiers: [{ type: "customer_id", value: "c-1" }],
      observedAt,
      source: "login",
    });

    expect(EMPTY_IDENTITY_GRAPH.nodes.size).toBe(0);
    expect(EMPTY_IDENTITY_GRAPH.edges).toHaveLength(0);
    expect(graph.nodes.size).toBe(2);
  });

  it("preserves firstSeenAt when an identifier is re-observed", () => {
    const first = stitchFromIdentifiers(EMPTY_IDENTITY_GRAPH, {
      visitorId: "v-1",
      identifiers: [],
      observedAt: "2026-07-01T00:00:00.000Z",
      source: "pageview",
    });
    const again = stitchFromIdentifiers(first, {
      visitorId: "v-1",
      identifiers: [],
      observedAt,
      source: "pageview",
    });

    expect(again.nodes.get("visitor_id:v-1")?.firstSeenAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("retains repeated observations as corroborating evidence", () => {
    const edge = {
      fromType: "visitor_id",
      fromValue: "v-1",
      toType: "device_id",
      toValue: "d-1",
      confidence: "probabilistic",
      observedAt,
      source: "fingerprint",
    } as const;

    const graph = addEdge(addEdge(EMPTY_IDENTITY_GRAPH, edge), edge);
    expect(graph.edges).toHaveLength(2);
  });

  it("classifies login-grade links as deterministic and device links as probabilistic", () => {
    expect(classifyEdge("visitor_id", "customer_id")).toBe("deterministic");
    expect(classifyEdge("visitor_id", "email_hash")).toBe("deterministic");
    expect(classifyEdge("visitor_id", "device_id")).toBe("probabilistic");
  });

  it("stitches two devices into one cluster through a shared customer id", () => {
    let graph = stitchFromIdentifiers(EMPTY_IDENTITY_GRAPH, {
      visitorId: "v-a",
      identifiers: [{ type: "customer_id", value: "c-1" }],
      observedAt,
      source: "login",
    });
    graph = stitchFromIdentifiers(graph, {
      visitorId: "v-b",
      identifiers: [{ type: "customer_id", value: "c-1" }],
      observedAt,
      source: "login",
    });

    const resolved = resolveIdentity(graph, "visitor_id", "v-a");
    expect(resolved?.members.map((m) => m.value).sort()).toEqual(["c-1", "v-a", "v-b"]);
    expect(resolved?.confidence).toBe("deterministic");
  });

  it("returns undefined for an unknown seed rather than inventing a cluster", () => {
    expect(resolveIdentity(EMPTY_IDENTITY_GRAPH, "visitor_id", "nope")).toBeUndefined();
  });

  it("never lets weak signals reach the certainty of one deterministic link", () => {
    const strong = [{ confidence: "deterministic" } as const];

    // Disjoint bands: otherwise a family sharing a tablet merges into one person, and both
    // attribution and personal data cross-contaminate.
    for (const count of [1, 5, 20, 200]) {
      const weak = Array.from({ length: count }, () => ({ confidence: "probabilistic" }) as const);
      expect(scoreConfidence(weak as never)).toBeLessThan(scoreConfidence(strong as never));
      expect(scoreConfidence(weak as never)).toBeLessThanOrEqual(PROBABILISTIC_CEILING);
    }

    expect(scoreConfidence(strong as never)).toBeGreaterThanOrEqual(DETERMINISTIC_FLOOR);
    expect(scoreConfidence([])).toBe(0);
  });

  it("raises confidence with corroboration inside each band, never across bands", () => {
    const one = [{ confidence: "probabilistic" } as const];
    const three = Array.from({ length: 3 }, () => ({ confidence: "probabilistic" }) as const);
    expect(scoreConfidence(three as never)).toBeGreaterThan(scoreConfidence(one as never));
  });
});

describe("attribution models", () => {
  function touch(day: number, channel: Touchpoint["channelGroup"]): Touchpoint {
    return {
      journeyId: "j-1",
      occurredAt: `2026-07-${String(day).padStart(2, "0")}T12:00:00.000Z`,
      channelGroup: channel,
    };
  }

  const journey: readonly Touchpoint[] = [
    touch(1, "organic_search"),
    touch(8, "paid_social"),
    touch(15, "email"),
    touch(19, "direct"),
  ];

  it("assigns all credit to the first touch", () => {
    const credits = assignCredit(journey, "first_touch", NOW);
    expect(credits).toEqual([{ touchIndex: 0, model: "first_touch", weight: 1 }]);
  });

  it("assigns all credit to the last touch", () => {
    expect(assignCredit(journey, "last_touch", NOW)[0]?.touchIndex).toBe(3);
  });

  it("splits credit evenly under linear", () => {
    const credits = assignCredit(journey, "linear", NOW);
    expect(credits.every((c) => c.weight === 0.25)).toBe(true);
  });

  it("weights first and last at 40% under position-based", () => {
    const credits = assignCredit(journey, "position_based", NOW);
    expect(credits[0]?.weight).toBeCloseTo(0.4);
    expect(credits[3]?.weight).toBeCloseTo(0.4);
    expect(credits[1]?.weight).toBeCloseTo(0.1);
  });

  it("favours recent touches under time decay", () => {
    const credits = assignCredit(journey, "time_decay", NOW);
    expect(credits[3]!.weight).toBeGreaterThan(credits[0]!.weight);
  });

  it("keeps every model normalized so revenue is neither invented nor lost", () => {
    for (const model of [
      "first_touch",
      "last_touch",
      "linear",
      "position_based",
      "time_decay",
      "data_driven",
    ] as const) {
      expect(creditsAreNormalized(assignCredit(journey, model, NOW))).toBe(true);
    }
  });

  it("handles one- and two-touch journeys without NaN", () => {
    expect(creditsAreNormalized(assignCredit([journey[0]!], "position_based", NOW))).toBe(true);
    expect(creditsAreNormalized(assignCredit(journey.slice(0, 2), "position_based", NOW))).toBe(
      true,
    );
  });

  it("falls back to an even split when every time-decay weight underflows", () => {
    const ancient = [touch(1, "email")];
    const farFuture = new Date("2030-01-01T00:00:00.000Z");
    expect(creditsAreNormalized(assignCredit(ancient, "time_decay", farFuture))).toBe(true);
  });

  it("marks a journey with no touchpoints unattributed rather than fabricating credit", () => {
    const snapshot = computeAttribution({
      journeyId: "j-1",
      touchpoints: [],
      model: "linear",
      conversionAt: NOW,
    });
    expect(snapshot.unattributed).toBe(true);
    expect(snapshot.credits).toHaveLength(0);
  });

  it("orders touchpoints chronologically before assigning credit", () => {
    const snapshot = computeAttribution({
      journeyId: "j-1",
      touchpoints: [touch(19, "direct"), touch(1, "organic_search")],
      model: "first_touch",
      conversionAt: NOW,
    });
    expect(snapshot.firstTouchChannel).toBe("organic_search");
    expect(snapshot.lastTouchChannel).toBe("direct");
  });

  it("records data_driven on the snapshot even though it currently falls back to linear", () => {
    const snapshot = computeAttribution({
      journeyId: "j-1",
      touchpoints: journey,
      model: "data_driven",
      conversionAt: NOW,
    });
    // The substitution stays visible rather than silent.
    expect(snapshot.model).toBe("data_driven");
  });
});

describe("PII hashing", () => {
  const hasher: HashPort = { sha256Hex: (input) => Promise.resolve(`sha256(${input})`) };

  it("hashes matchable fields after normalization", async () => {
    const normalized = normalizeIdentity({ email: " Ali@Example.COM ", firstName: "Ahmed" });
    const hashed = await hashIdentity(normalized, hasher);

    expect(hashed.email).toBe("sha256(ali@example.com)");
    expect(hashed.hashStatus).toBe("sha256");
  });

  it("refuses to double hash", async () => {
    const once = await hashIdentity(normalizeIdentity({ email: "a@b.com" }), hasher);
    await expect(hashIdentity(once, hasher)).rejects.toThrow(DoubleHashError);
  });

  it("refuses an identity whose hash state is unknown rather than assuming raw", async () => {
    await expect(hashIdentity({ email: "a@b.com" }, hasher)).rejects.toThrow(DoubleHashError);
  });

  it("leaves externalId unhashed — platforms expect it opaque", () => {
    expect(HASHED_FIELDS).not.toContain("externalId");
    expect(HASHED_FIELDS).toContain("email");
  });

  it("preserves non-matchable identifiers untouched", async () => {
    const hashed = await hashIdentity(
      normalizeIdentity({ email: "a@b.com", customerId: "c-1" }),
      hasher,
    );
    expect(hashed.customerId).toBe("c-1");
  });

  it("marks only hashed blocks forwardable", async () => {
    const normalized = normalizeIdentity({ email: "a@b.com" });
    expect(isForwardable(normalized)).toBe(false);
    expect(isForwardable(await hashIdentity(normalized, hasher))).toBe(true);
  });
});

describe("pipeline order invariants", () => {
  it("matches the directive's canonical order", () => {
    expect([...PIPELINE_STAGES]).toEqual([
      "capture",
      "normalize",
      "validate",
      "enrichment",
      "identity_stitching",
      "consent_resolution",
      "attribution",
      "pii_hashing",
      "platform_mapping",
      "destination_formatting",
      // Added in M6: REPLAY_STAGES already named both, but the record's stage vocabulary could not
      // express them, so the runtime had no way to record routing or retry in stage history.
      "destination_routing",
      "delivery",
      "retry",
    ]);
  });

  it("orders routing before delivery and retry after it", () => {
    expect(stagePrecedes("destination_routing", "delivery")).toBe(true);
    expect(stagePrecedes("delivery", "retry")).toBe(true);
  });

  it("hashes only after normalize, stitching and consent — and before delivery", () => {
    expect(stagePrecedes("normalize", "pii_hashing")).toBe(true);
    expect(stagePrecedes("identity_stitching", "pii_hashing")).toBe(true);
    expect(stagePrecedes("consent_resolution", "pii_hashing")).toBe(true);
    expect(stagePrecedes("pii_hashing", "delivery")).toBe(true);
    expect(stagePrecedes("pii_hashing", "normalize")).toBe(false);
  });

  it("attributes before hashing, so stitching still sees raw identifiers", () => {
    expect(stagePrecedes("attribution", "pii_hashing")).toBe(true);
  });
});
