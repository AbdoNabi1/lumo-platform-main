import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { Expr } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import { wireCustomer360 } from "./composition";
import type { AttributeValue } from "./domain/attribute-value";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-20T00:00:00.000Z") };

function wire() {
  return wireCustomer360({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("Customer 360 Identity Engine (end to end)", () => {
  it("observes links, resolves a deterministic cluster, and publishes link_observed events", async () => {
    const app = wire();

    const observed = await app.observeIdentityLink.execute({
      visitorId: "visitor-1",
      identifiers: [
        { type: "email_hash", value: "hash-alice" },
        { type: "device_id", value: "device-1" },
      ],
      observedAt: clock.now().toISOString(),
      source: "checkout",
    });
    expect(observed.ok).toBe(true);
    if (!observed.ok) throw new Error("unreachable");
    expect(observed.value.edgesObserved).toBe(2);

    const published = await app.drainOutbox();
    expect(published).toBe(2);

    const resolved = await app.resolveIdentity.execute({ type: "visitor_id", value: "visitor-1" });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error("unreachable");
    expect(resolved.value.cluster).not.toBeNull();
    expect(resolved.value.cluster?.resolved.members).toHaveLength(3); // visitor + email + device
    expect(resolved.value.cluster?.resolved.confidence).toBe("deterministic"); // email_hash anchors it
  });

  it("merge links two previously-unrelated identifiers with provenance, resolved together afterwards", async () => {
    const app = wire();
    await app.observeIdentityLink.execute({
      visitorId: "visitor-guest",
      identifiers: [{ type: "device_id", value: "device-shared" }],
      observedAt: clock.now().toISOString(),
      source: "guest_checkout",
    });
    await app.observeIdentityLink.execute({
      visitorId: "visitor-known",
      identifiers: [{ type: "customer_id", value: "cust-1" }],
      observedAt: clock.now().toISOString(),
      source: "login",
    });

    const merge = await app.mergeIdentities.execute({
      subject: { type: "visitor_id", value: "visitor-guest" },
      related: { type: "visitor_id", value: "visitor-known" },
      reason: "confirmed same person via support ticket",
      actor: "operator-1",
    });
    expect(merge.ok).toBe(true);

    const resolved = await app.resolveIdentity.execute({
      type: "visitor_id",
      value: "visitor-guest",
    });
    if (!resolved.ok) throw new Error("unreachable");
    const memberValues = resolved.value.cluster?.resolved.members.map((m) => m.value) ?? [];
    expect(memberValues).toEqual(
      expect.arrayContaining(["visitor-guest", "device-shared", "visitor-known", "cust-1"]),
    );
  });

  it("rejects merging an identifier with itself", async () => {
    const app = wire();
    const result = await app.mergeIdentities.execute({
      subject: { type: "visitor_id", value: "v1" },
      related: { type: "visitor_id", value: "v1" },
      reason: "n/a",
      actor: "operator-1",
    });
    expect(result.ok).toBe(false);
  });

  it("split retracts a wrong observation from future resolution, timeline records both sides", async () => {
    const app = wire();
    const observedAt = clock.now().toISOString();
    await app.observeIdentityLink.execute({
      visitorId: "visitor-family",
      identifiers: [{ type: "device_id", value: "shared-tablet" }],
      observedAt,
      source: "server_stitch",
    });

    const preSplit = await app.resolveIdentity.execute({
      type: "visitor_id",
      value: "visitor-family",
    });
    if (!preSplit.ok) throw new Error("unreachable");
    expect(preSplit.value.cluster?.resolved.members).toHaveLength(2);

    const split = await app.splitIdentity.execute({
      edge: {
        fromType: "visitor_id",
        fromValue: "visitor-family",
        toType: "device_id",
        toValue: "shared-tablet",
        confidence: "probabilistic",
        observedAt,
        source: "server_stitch",
      },
      reason: "shared family tablet, not the same person",
      actor: "operator-2",
    });
    expect(split.ok).toBe(true);

    const postSplit = await app.resolveIdentity.execute({
      type: "visitor_id",
      value: "visitor-family",
    });
    if (!postSplit.ok) throw new Error("unreachable");
    expect(postSplit.value.cluster?.resolved.members).toHaveLength(1);

    const timeline = await app.getIdentityTimeline.execute({
      identifier: { type: "visitor_id", value: "visitor-family" },
    });
    if (!timeline.ok) throw new Error("unreachable");
    expect(timeline.value.entries.map((e) => e.kind)).toEqual(["observed", "split"]);
  });

  it("rejects splitting an edge that was never observed instead of silently no-oping", async () => {
    const app = wire();
    const result = await app.splitIdentity.execute({
      edge: {
        fromType: "visitor_id",
        fromValue: "visitor-nonexistent",
        toType: "device_id",
        toValue: "never-seen",
        confidence: "probabilistic",
        observedAt: clock.now().toISOString(),
        source: "server_stitch",
      },
      reason: "typo'd edge",
      actor: "operator-3",
    });
    expect(result.ok).toBe(false);
  });

  it("splits successfully even when the caller supplies the edge with endpoints swapped", async () => {
    const app = wire();
    const observedAt = clock.now().toISOString();
    await app.observeIdentityLink.execute({
      visitorId: "visitor-swap",
      identifiers: [{ type: "device_id", value: "shared-tablet-2" }],
      observedAt,
      source: "server_stitch",
    });

    const split = await app.splitIdentity.execute({
      edge: {
        // Reversed relative to how ObserveIdentityLink stored it (visitor as `from`).
        fromType: "device_id",
        fromValue: "shared-tablet-2",
        toType: "visitor_id",
        toValue: "visitor-swap",
        confidence: "probabilistic",
        observedAt,
        source: "server_stitch",
      },
      reason: "shared family tablet",
      actor: "operator-4",
    });
    expect(split.ok).toBe(true);

    const resolved = await app.resolveIdentity.execute({
      type: "visitor_id",
      value: "visitor-swap",
    });
    if (!resolved.ok) throw new Error("unreachable");
    expect(resolved.value.cluster?.resolved.members).toHaveLength(1);
  });
});

describe("Customer 360 Profile Engine (end to end, Phase 6.2)", () => {
  it("updates a field, reads it back through GetCustomerProfile, and publishes profile.created", async () => {
    const app = wire();
    const identifier = { type: "customer_id" as const, value: "cust-1" };

    const update = await app.updateProfileProjection.execute({
      identifier,
      field: "email",
      value: "a@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });
    expect(update.ok).toBe(true);
    if (!update.ok) throw new Error("unreachable");
    expect(update.value).toEqual({ applied: true, version: 1 });

    const published = await app.drainOutbox();
    expect(published).toBe(1);

    const read = await app.getCustomerProfile.execute({
      identifier,
      now: clock.now().toISOString(),
    });
    if (!read.ok) throw new Error("unreachable");
    expect(read.value.profile?.fields.get("email")?.value).toBe("a@example.com");
    expect(read.value.confidence?.overall).toBe("verified");
  });

  it("merges profiles across an Identity Engine cluster into one unified read (the 360 view)", async () => {
    const app = wire();
    const guestVisitor = { type: "visitor_id" as const, value: "visitor-guest-2" };
    const knownCustomer = { type: "customer_id" as const, value: "cust-2" };

    // Two separate identifiers, each with their own profile fields...
    await app.updateProfileProjection.execute({
      identifier: guestVisitor,
      field: "device",
      value: "device-42",
      source: "tracking",
      confidence: "inferred",
      occurredAt: clock.now().toISOString(),
    });
    await app.updateProfileProjection.execute({
      identifier: knownCustomer,
      field: "email",
      value: "known@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });

    // ...linked by Identity Engine's own merge (Phase 6.1), reused here rather than reimplemented.
    await app.mergeIdentities.execute({
      subject: guestVisitor,
      related: knownCustomer,
      reason: "confirmed same person via support ticket",
      actor: "operator-1",
    });

    const read = await app.getCustomerProfile.execute({
      identifier: guestVisitor,
      now: clock.now().toISOString(),
    });
    if (!read.ok) throw new Error("unreachable");
    expect(read.value.profile?.fields.get("device")?.value).toBe("device-42");
    expect(read.value.profile?.fields.get("email")?.value).toBe("known@example.com");
    expect(read.value.mergedFrom.map((m) => m.value).sort()).toEqual(["cust-2", "visitor-guest-2"]);
  });

  it("rejects a stale field update end to end, leaving the fresher value intact", async () => {
    const app = wire();
    const identifier = { type: "customer_id" as const, value: "cust-3" };

    await app.updateProfileProjection.execute({
      identifier,
      field: "email",
      value: "current@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-20T00:00:10.000Z",
    });
    const stale = await app.updateProfileProjection.execute({
      identifier,
      field: "email",
      value: "stale@example.com",
      source: "enrichment",
      confidence: "inferred",
      occurredAt: "2026-07-20T00:00:05.000Z",
    });

    if (!stale.ok) throw new Error("unreachable");
    expect(stale.value.applied).toBe(false);

    const read = await app.getCustomerProfile.execute({
      identifier,
      now: "2026-07-20T00:01:00.000Z",
    });
    if (!read.ok) throw new Error("unreachable");
    expect(read.value.profile?.fields.get("email")?.value).toBe("current@example.com");
  });

  it("rebuilds the current-view cache from history via RebuildProfileProjection", async () => {
    const app = wire();
    const identifier = { type: "customer_id" as const, value: "cust-4" };

    await app.updateProfileProjection.execute({
      identifier,
      field: "email",
      value: "a@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });

    const rebuilt = await app.rebuildProfileProjection.execute({ identifier });
    if (!rebuilt.ok) throw new Error("unreachable");
    expect(rebuilt.value.profile?.fields.get("email")?.value).toBe("a@example.com");
    expect(rebuilt.value.profile?.version).toBe(1); // rebuild must not inflate the version

    const published = await app.drainOutbox();
    expect(published).toBe(2); // profile.created + profile.rebuilt
  });

  it("ProfileProjectionWorker rebuilds every known profile in one batch", async () => {
    const app = wire();
    await app.updateProfileProjection.execute({
      identifier: { type: "customer_id", value: "cust-5" },
      field: "email",
      value: "a@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });
    await app.updateProfileProjection.execute({
      identifier: { type: "customer_id", value: "cust-6" },
      field: "email",
      value: "b@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });

    const result = await app.profileProjectionWorker.execute({});
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ rebuilt: 2, failed: 0 });
  });
});

describe("Customer 360 Session Stitching Engine (end to end, Phase 6.3)", () => {
  it("opens a session on first activity and folds subsequent activity into it", async () => {
    const app = wire();

    const first = await app.observeSession.execute({
      sessionId: "sess-1",
      visitorId: "visitor-1",
      deviceId: "device-1",
      source: "web",
      occurredAt: "2026-07-20T00:00:00.000Z",
    });
    if (!first.ok) throw new Error("unreachable");
    expect(first.value).toEqual({ sessionId: "sess-1", opened: true, rolledOverFrom: undefined });

    const second = await app.observeSession.execute({
      sessionId: "sess-1",
      visitorId: "visitor-1",
      occurredAt: "2026-07-20T00:05:00.000Z",
    });
    if (!second.ok) throw new Error("unreachable");
    expect(second.value).toEqual({ sessionId: "sess-1", opened: false });

    const published = await app.drainOutbox();
    expect(published).toBe(2); // session.started + session.updated
  });

  it("rolls over into a new session on a timeout, chaining a timed_out transition", async () => {
    const app = wire();

    await app.observeSession.execute({
      sessionId: "sess-1",
      visitorId: "visitor-1",
      occurredAt: "2026-07-20T00:00:00.000Z",
    });
    const rollover = await app.observeSession.execute({
      sessionId: "sess-2",
      visitorId: "visitor-1",
      occurredAt: "2026-07-20T01:00:00.000Z", // 60 minutes later — past the 30-minute default window
    });
    if (!rollover.ok) throw new Error("unreachable");
    expect(rollover.value).toEqual({ sessionId: "sess-2", opened: true, rolledOverFrom: "sess-1" });

    const timeline = await app.getJourneyTimeline.execute({ visitorId: "visitor-1" });
    if (!timeline.ok) throw new Error("unreachable");
    const kinds = timeline.value.entries.map((e) => e.kind);
    expect(kinds).toEqual(["session_started", "session_closed", "session_started", "transition"]);

    const transition = timeline.value.entries.find((e) => e.kind === "transition");
    expect(transition).toMatchObject({
      transitionKind: "timed_out",
      fromSessionId: "sess-1",
      toSessionId: "sess-2",
    });
  });

  it("explicitly closes a session and rejects closing it again", async () => {
    const app = wire();
    await app.observeSession.execute({
      sessionId: "sess-1",
      visitorId: "visitor-1",
      occurredAt: clock.now().toISOString(),
    });

    const closed = await app.closeSession.execute({
      sessionId: "sess-1",
      reason: "manual_logout",
      occurredAt: "2026-07-20T00:10:00.000Z",
    });
    expect(closed.ok).toBe(true);

    const again = await app.closeSession.execute({
      sessionId: "sess-1",
      reason: "manual_logout",
      occurredAt: "2026-07-20T00:11:00.000Z",
    });
    expect(again.ok).toBe(false);
  });

  it("resumes a closed session into a new one, linked by a resumed transition", async () => {
    const app = wire();
    await app.observeSession.execute({
      sessionId: "sess-1",
      visitorId: "visitor-1",
      occurredAt: "2026-07-20T00:00:00.000Z",
    });
    await app.closeSession.execute({
      sessionId: "sess-1",
      reason: "manual_logout",
      occurredAt: "2026-07-20T00:10:00.000Z",
    });

    const resumed = await app.resumeSession.execute({
      closedSessionId: "sess-1",
      sessionId: "sess-2",
      visitorId: "visitor-1",
      occurredAt: "2026-07-20T02:00:00.000Z",
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error("unreachable");

    const timeline = await app.getJourneyTimeline.execute({ visitorId: "visitor-1" });
    if (!timeline.ok) throw new Error("unreachable");
    const transition = timeline.value.entries.find((e) => e.kind === "transition");
    expect(transition).toMatchObject({
      transitionKind: "resumed",
      fromSessionId: "sess-1",
      toSessionId: "sess-2",
    });
  });

  it("rejects resuming a session that is still open", async () => {
    const app = wire();
    await app.observeSession.execute({
      sessionId: "sess-1",
      visitorId: "visitor-1",
      occurredAt: clock.now().toISOString(),
    });

    const resumed = await app.resumeSession.execute({
      closedSessionId: "sess-1",
      sessionId: "sess-2",
      visitorId: "visitor-1",
      occurredAt: clock.now().toISOString(),
    });
    expect(resumed.ok).toBe(false);
  });

  it("splits a shared-device session into two, closing the original and opening a new one", async () => {
    const app = wire();
    await app.observeSession.execute({
      sessionId: "sess-shared",
      visitorId: "visitor-family",
      deviceId: "shared-tablet",
      occurredAt: "2026-07-20T00:00:00.000Z",
    });

    const split = await app.splitSession.execute({
      sessionId: "sess-shared",
      newSessionId: "sess-shared-2",
      splitAt: "2026-07-20T00:15:00.000Z",
      reason: "shared family tablet — second person picked it up",
      actor: "operator-1",
    });
    expect(split.ok).toBe(true);

    const original = await app.rebuildSessions.execute({ sessionId: "sess-shared" });
    if (!original.ok) throw new Error("unreachable");
    expect(original.value.session?.status).toBe("closed");
    expect(original.value.session?.closeReason).toBe("explicit_split");

    const timeline = await app.getJourneyTimeline.execute({ visitorId: "visitor-family" });
    if (!timeline.ok) throw new Error("unreachable");
    const transition = timeline.value.entries.find((e) => e.kind === "transition");
    expect(transition).toMatchObject({
      transitionKind: "explicit_split",
      fromSessionId: "sess-shared",
      toSessionId: "sess-shared-2",
    });
  });

  it("rejects splitting a session that was never observed", async () => {
    const app = wire();
    const split = await app.splitSession.execute({
      sessionId: "never-seen",
      newSessionId: "sess-2",
      splitAt: clock.now().toISOString(),
      reason: "n/a",
      actor: "operator-1",
    });
    expect(split.ok).toBe(false);
  });

  it("merges two independently tracked sessions into one journey without touching either session", async () => {
    const app = wire();
    await app.observeSession.execute({
      sessionId: "sess-desktop",
      visitorId: "visitor-desktop",
      deviceId: "device-desktop",
      occurredAt: "2026-07-20T00:00:00.000Z",
    });
    await app.observeSession.execute({
      sessionId: "sess-mobile",
      visitorId: "visitor-mobile",
      deviceId: "device-mobile",
      occurredAt: "2026-07-20T01:00:00.000Z",
    });

    const before = await app.rebuildSessions.execute({ sessionId: "sess-desktop" });
    const merge = await app.mergeSession.execute({
      fromSessionId: "sess-desktop",
      toSessionId: "sess-mobile",
      reason: "confirmed same shopper via support ticket",
      actor: "operator-1",
    });
    expect(merge.ok).toBe(true);
    const after = await app.rebuildSessions.execute({ sessionId: "sess-desktop" });

    if (!before.ok || !after.ok) throw new Error("unreachable");
    expect(after.value.session).toEqual(before.value.session); // merge never mutates either session

    const timeline = await app.getJourneyTimeline.execute({ visitorId: "visitor-desktop" });
    if (!timeline.ok) throw new Error("unreachable");
    const transition = timeline.value.entries.find((e) => e.kind === "transition");
    expect(transition).toMatchObject({ transitionKind: "explicit_merge" });
  });

  it("rejects merging a session with itself and rejects merging never-observed sessions", async () => {
    const app = wire();
    await app.observeSession.execute({
      sessionId: "sess-1",
      visitorId: "visitor-1",
      occurredAt: clock.now().toISOString(),
    });

    const selfMerge = await app.mergeSession.execute({
      fromSessionId: "sess-1",
      toSessionId: "sess-1",
      reason: "n/a",
      actor: "operator-1",
    });
    expect(selfMerge.ok).toBe(false);

    const neverObserved = await app.mergeSession.execute({
      fromSessionId: "sess-1",
      toSessionId: "never-seen",
      reason: "n/a",
      actor: "operator-1",
    });
    expect(neverObserved.ok).toBe(false);
  });

  it("resolves the current session across devices via Identity Engine reuse (never a second stitching implementation)", async () => {
    const app = wire();
    await app.observeSession.execute({
      sessionId: "sess-guest",
      visitorId: "visitor-guest",
      occurredAt: "2026-07-20T00:00:00.000Z",
    });
    await app.observeSession.execute({
      sessionId: "sess-known",
      visitorId: "visitor-known",
      occurredAt: "2026-07-20T01:00:00.000Z", // more recently active
    });

    // Two visitor_ids linked via Identity Engine's own merge — Session Stitching reuses this, never
    // reimplements it.
    await app.mergeIdentities.execute({
      subject: { type: "visitor_id", value: "visitor-guest" },
      related: { type: "visitor_id", value: "visitor-known" },
      reason: "confirmed same person",
      actor: "operator-1",
    });

    const current = await app.resolveCurrentSession.execute({
      identifier: { type: "visitor_id", value: "visitor-guest" },
    });
    if (!current.ok) throw new Error("unreachable");
    expect(current.value.session?.sessionId).toBe("sess-known"); // most recently active of the cluster
    expect([...current.value.consideredVisitorIds].sort()).toEqual([
      "visitor-guest",
      "visitor-known",
    ]);
  });

  it("tracks the anonymous -> identified journey transition and journey state", async () => {
    const app = wire();
    await app.observeSession.execute({
      sessionId: "sess-1",
      visitorId: "visitor-1",
      occurredAt: "2026-07-20T00:00:00.000Z",
    });

    const beforeState = await app.getJourneyState.execute({ visitorId: "visitor-1" });
    if (!beforeState.ok) throw new Error("unreachable");
    expect(beforeState.value.state.identified).toBe(false);
    expect(beforeState.value.state.sessionCount).toBe(1);
    expect(beforeState.value.state.currentSessionId).toBe("sess-1");

    // A later activity on the same session carries a known-identity signal (e.g. login) — the
    // caller passes `identified: true` (its own `isKnownIdentity` result), never re-derived here.
    await app.observeSession.execute({
      sessionId: "sess-1",
      visitorId: "visitor-1",
      occurredAt: "2026-07-20T00:05:00.000Z",
      identified: true,
    });

    const afterState = await app.getJourneyState.execute({ visitorId: "visitor-1" });
    if (!afterState.ok) throw new Error("unreachable");
    expect(afterState.value.state.identified).toBe(true);

    const timeline = await app.getJourneyTimeline.execute({ visitorId: "visitor-1" });
    if (!timeline.ok) throw new Error("unreachable");
    const transition = timeline.value.entries.find((e) => e.kind === "transition");
    expect(transition).toMatchObject({
      transitionKind: "anonymous_to_identified",
      fromSessionId: "sess-1",
    });

    // A later call with `identified: true` again must not record a second transition.
    await app.observeSession.execute({
      sessionId: "sess-1",
      visitorId: "visitor-1",
      occurredAt: "2026-07-20T00:10:00.000Z",
      identified: true,
    });
    const finalTimeline = await app.getJourneyTimeline.execute({ visitorId: "visitor-1" });
    if (!finalTimeline.ok) throw new Error("unreachable");
    expect(finalTimeline.value.entries.filter((e) => e.kind === "transition")).toHaveLength(1);
  });

  it("rebuilds a session's cache from history and reports null for a session with no history", async () => {
    const app = wire();
    await app.observeSession.execute({
      sessionId: "sess-1",
      visitorId: "visitor-1",
      occurredAt: clock.now().toISOString(),
    });

    const rebuilt = await app.rebuildSessions.execute({ sessionId: "sess-1" });
    if (!rebuilt.ok) throw new Error("unreachable");
    expect(rebuilt.value.session?.sessionId).toBe("sess-1");

    const missing = await app.rebuildSessions.execute({ sessionId: "never-seen" });
    if (!missing.ok) throw new Error("unreachable");
    expect(missing.value.session).toBeNull();
  });

  it("SessionProjectionWorker rebuilds every known session in one batch", async () => {
    const app = wire();
    await app.observeSession.execute({
      sessionId: "sess-1",
      visitorId: "visitor-1",
      occurredAt: clock.now().toISOString(),
    });
    await app.observeSession.execute({
      sessionId: "sess-2",
      visitorId: "visitor-2",
      occurredAt: clock.now().toISOString(),
    });

    const result = await app.sessionProjectionWorker.execute({});
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ rebuilt: 2, failed: 0 });
  });
});

describe("Customer 360 Computed Attributes Engine (end to end)", () => {
  const customer = { type: "customer_id" as const, value: "cust-1" };

  function clvTierDefinition() {
    const ruleSet: RuleSet<AttributeValue> = {
      id: "clv_tier",
      version: 1,
      mode: "first_match",
      rules: [
        {
          id: "gold",
          priority: 1,
          when: Expr.where("profile.lifetime_value", "gte", 1000),
          then: "gold",
        },
        { id: "bronze", priority: 2, when: Expr.literal(true), then: "bronze" },
      ],
    };
    return { id: "clv_tier", version: 1, ruleSet, dependencies: [] };
  }

  function isVipDefinition() {
    const ruleSet: RuleSet<AttributeValue> = {
      id: "is_vip",
      version: 1,
      mode: "first_match",
      rules: [
        {
          id: "vip-rule",
          priority: 1,
          when: Expr.where("attributes.clv_tier", "eq", "gold"),
          then: true,
        },
      ],
      fallback: false,
    };
    return { id: "is_vip", version: 1, ruleSet, dependencies: ["clv_tier"] };
  }

  function unrelatedDefinition() {
    const ruleSet: RuleSet<AttributeValue> = {
      id: "newsletter_opt_in_guess",
      version: 1,
      mode: "first_match",
      rules: [{ id: "always-false", priority: 1, when: Expr.literal(true), then: false }],
    };
    return { id: "newsletter_opt_in_guess", version: 1, ruleSet, dependencies: [] };
  }

  function wireWithDefinitions() {
    return wireCustomer360({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      computedAttributeDefinitions: [clvTierDefinition(), isVipDefinition(), unrelatedDefinition()],
    });
  }

  it("evaluates a computed attribute from merged profile facts and persists it with full explainability", async () => {
    const app = wireWithDefinitions();
    await app.updateProfileProjection.execute({
      identifier: customer,
      field: "lifetime_value",
      value: 5000,
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });

    const evaluated = await app.evaluateComputedAttribute.execute({
      identifier: customer,
      definition: clvTierDefinition(),
    });
    if (!evaluated.ok) throw new Error("unreachable");
    expect(evaluated.value.result.value).toBe("gold");
    expect(evaluated.value.result.matchedRuleIds).toEqual(["gold"]);
    expect(evaluated.value.result.inputs.get("profile.lifetime_value")).toBe(5000);

    const persisted = await app.updateComputedAttributeProjection.execute({
      identifier: customer,
      result: evaluated.value.result,
    });
    if (!persisted.ok) throw new Error("unreachable");
    expect(persisted.value.applied).toBe(true);

    const read = await app.getComputedAttributes.execute({
      identifier: customer,
      now: clock.now().toISOString(),
    });
    if (!read.ok) throw new Error("unreachable");
    const stored = read.value.attribute?.attributes.get("clv_tier");
    expect(stored?.value).toBe("gold");
    // Why/inputs/rules/timestamp/source all recoverable from the stored value alone, no re-evaluation.
    expect(stored?.matchedRuleIds).toEqual(["gold"]);
    expect(stored?.inputs.get("profile.lifetime_value")).toBe(5000);
    expect(stored?.definitionId).toBe("clv_tier");
    expect(stored?.evaluatedAt).toBeTruthy();

    expect(await app.drainOutbox()).toBe(2); // ProfileCreated + AttributeCreated
  });

  it("EvaluateAttributeGraph evaluates a dependency chain in one run, dependent sees dependency's fresh value", async () => {
    const app = wireWithDefinitions();
    await app.updateProfileProjection.execute({
      identifier: customer,
      field: "lifetime_value",
      value: 5000,
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });

    const result = await app.evaluateAttributeGraph.execute({
      identifier: customer,
      definitions: [isVipDefinition(), clvTierDefinition()], // deliberately out of order
    });
    if (!result.ok) throw new Error("unreachable");
    const byId = new Map(result.value.results.map((r) => [r.definitionId, r]));
    expect(byId.get("clv_tier")?.value).toBe("gold");
    expect(byId.get("is_vip")?.value).toBe(true);
  });

  it("RecalculateComputedAttributes recomputes only the changed attribute's dependents, never an unrelated attribute", async () => {
    const app = wireWithDefinitions();
    await app.updateProfileProjection.execute({
      identifier: customer,
      field: "lifetime_value",
      value: 50, // below the gold threshold
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });

    const initial = await app.recalculateComputedAttributes.execute({ identifier: customer });
    if (!initial.ok) throw new Error("unreachable");
    expect([...initial.value.recomputed].sort()).toEqual([
      "clv_tier",
      "is_vip",
      "newsletter_opt_in_guess",
    ]);

    // A profile field clv_tier reads just changed — the caller (an upstream consumer, not built in
    // this phase) names exactly which attribute's raw inputs moved.
    await app.updateProfileProjection.execute({
      identifier: customer,
      field: "lifetime_value",
      value: 5000, // now above the gold threshold
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-20T01:00:00.000Z",
    });

    const incremental = await app.recalculateComputedAttributes.execute({
      identifier: customer,
      changed: ["clv_tier"],
    });
    if (!incremental.ok) throw new Error("unreachable");
    expect([...incremental.value.recomputed].sort()).toEqual(["clv_tier", "is_vip"]);
    expect(incremental.value.recomputed).not.toContain("newsletter_opt_in_guess");
    expect([...incremental.value.applied].sort()).toEqual(["clv_tier", "is_vip"]); // both actually changed value

    const read = await app.getComputedAttributes.execute({
      identifier: customer,
      now: clock.now().toISOString(),
    });
    if (!read.ok) throw new Error("unreachable");
    expect(read.value.attribute?.attributes.get("clv_tier")?.value).toBe("gold");
    expect(read.value.attribute?.attributes.get("is_vip")?.value).toBe(true);
  });

  it("RecalculateComputedAttributes stops with a clear error when the registered graph has a cycle", async () => {
    const cyclicRuleSet: RuleSet<AttributeValue> = {
      id: "cyclic",
      version: 1,
      mode: "first_match",
      rules: [{ id: "r", priority: 1, when: Expr.literal(true), then: true }],
    };
    const app = wireCustomer360({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      computedAttributeDefinitions: [
        { id: "a", version: 1, ruleSet: cyclicRuleSet, dependencies: ["b"] },
        { id: "b", version: 1, ruleSet: cyclicRuleSet, dependencies: ["a"] },
      ],
    });

    const result = await app.recalculateComputedAttributes.execute({ identifier: customer });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toMatch(/cycle/i);
  });

  it("RebuildComputedAttributes and ComputedAttributeProjectionWorker rebuild the cache from history", async () => {
    const app = wireWithDefinitions();
    await app.updateProfileProjection.execute({
      identifier: customer,
      field: "lifetime_value",
      value: 5000,
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });
    await app.recalculateComputedAttributes.execute({ identifier: customer });

    const rebuilt = await app.rebuildComputedAttributes.execute({ identifier: customer });
    if (!rebuilt.ok) throw new Error("unreachable");
    expect(rebuilt.value.attribute?.attributes.get("clv_tier")?.value).toBe("gold");

    const worker = await app.computedAttributeProjectionWorker.execute({});
    if (!worker.ok) throw new Error("unreachable");
    expect(worker.value.rebuilt).toBeGreaterThanOrEqual(1);
    expect(worker.value.failed).toBe(0);
  });
});

describe("Customer 360 Segmentation Engine (end to end, Phase 6.5)", () => {
  const customer = { type: "customer_id" as const, value: "cust-1" };

  function highValueRuleSet(): RuleSet<boolean> {
    return {
      id: "high_value",
      version: 1,
      mode: "first_match",
      rules: [
        {
          id: "high-value-rule",
          priority: 1,
          when: Expr.where("profile.lifetime_value", "gte", 1000),
          then: true,
        },
      ],
      fallback: false,
    };
  }

  function goldTierSegmentRuleSet(): RuleSet<boolean> {
    return {
      id: "gold_tier_customers",
      version: 1,
      mode: "first_match",
      rules: [
        {
          id: "gold-rule",
          priority: 1,
          when: Expr.where("attributes.clv_tier", "eq", "gold"),
          then: true,
        },
      ],
      fallback: false,
    };
  }

  it("CreateSegment authors a definition, then EvaluateSegment/RecalculateMemberships evaluate it end to end with full explainability", async () => {
    const app = wire();
    const created = await app.createSegment.execute({
      id: "high_value",
      name: "High value",
      ruleSet: highValueRuleSet(),
    });
    expect(created.ok).toBe(true);

    await app.updateProfileProjection.execute({
      identifier: customer,
      field: "lifetime_value",
      value: 5000,
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });

    const recalculated = await app.recalculateMemberships.execute({
      identifier: customer,
      changed: ["profile.lifetime_value"],
    });
    expect(recalculated.ok).toBe(true);
    if (!recalculated.ok) throw new Error("unreachable");
    expect(recalculated.value.recomputed).toEqual(["high_value"]);
    expect(recalculated.value.applied).toEqual(["high_value"]);
    expect(recalculated.value.results[0]?.isMember).toBe(true);
    expect(recalculated.value.results[0]?.matchedRuleIds).toEqual(["high-value-rule"]);

    const members = await app.getCustomerSegments.execute({ identifier: customer });
    if (!members.ok) throw new Error("unreachable");
    expect(members.value.segment.memberships.get("high_value")?.status).toBe("entered");

    const segmentMembers = await app.getSegmentMembers.execute({ segmentId: "high_value" });
    if (!segmentMembers.ok) throw new Error("unreachable");
    expect(segmentMembers.value.members.map((m) => m.identifierValue)).toEqual([customer.value]);

    expect(await app.drainOutbox()).toBe(3); // SegmentCreated + ProfileCreated + CustomerEnteredSegment
  });

  it("transitions to exited when a fact no longer matches, and GetSegmentMembers no longer lists the identifier", async () => {
    const app = wire();
    await app.createSegment.execute({
      id: "high_value",
      name: "High value",
      ruleSet: highValueRuleSet(),
    });
    await app.updateProfileProjection.execute({
      identifier: customer,
      field: "lifetime_value",
      value: 5000,
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });
    await app.recalculateMemberships.execute({
      identifier: customer,
      changed: ["profile.lifetime_value"],
    });

    await app.updateProfileProjection.execute({
      identifier: customer,
      field: "lifetime_value",
      value: 10,
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-20T01:00:00.000Z",
    });
    const recalculated = await app.recalculateMemberships.execute({
      identifier: customer,
      changed: ["profile.lifetime_value"],
    });
    if (!recalculated.ok) throw new Error("unreachable");
    expect(recalculated.value.results[0]?.isMember).toBe(false);

    const members = await app.getCustomerSegments.execute({ identifier: customer });
    if (!members.ok) throw new Error("unreachable");
    expect(members.value.segment.memberships.get("high_value")?.status).toBe("exited");

    const segmentMembers = await app.getSegmentMembers.execute({ segmentId: "high_value" });
    if (!segmentMembers.ok) throw new Error("unreachable");
    expect(segmentMembers.value.members).toEqual([]);
  });

  it("RecalculateMemberships never recomputes an unrelated segment for a changed fact path it does not depend on", async () => {
    const app = wire();
    await app.createSegment.execute({
      id: "high_value",
      name: "High value",
      ruleSet: highValueRuleSet(),
    });
    await app.createSegment.execute({
      id: "email_present",
      name: "Has email",
      ruleSet: {
        id: "email_present",
        version: 1,
        mode: "first_match",
        rules: [{ id: "r1", priority: 1, when: Expr.exists("profile.email"), then: true }],
        fallback: false,
      },
    });

    const recalculated = await app.recalculateMemberships.execute({
      identifier: customer,
      changed: ["profile.lifetime_value"],
    });
    if (!recalculated.ok) throw new Error("unreachable");
    expect(recalculated.value.recomputed).toEqual(["high_value"]);
    expect(recalculated.value.recomputed).not.toContain("email_present");
  });

  it("a segment depending on a computed attribute reuses GetComputedAttributes (evaluation pipeline: Profile -> Computed Attributes -> RuleSet)", async () => {
    const app = wireCustomer360({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      computedAttributeDefinitions: [
        {
          id: "clv_tier",
          version: 1,
          ruleSet: {
            id: "clv_tier",
            version: 1,
            mode: "first_match",
            rules: [
              {
                id: "gold",
                priority: 1,
                when: Expr.where("profile.lifetime_value", "gte", 1000),
                then: "gold",
              },
            ],
            fallback: "bronze",
          },
          dependencies: [],
        },
      ],
      segmentDefinitions: [
        {
          id: "gold_tier_customers",
          name: "Gold tier",
          version: 1,
          ruleSet: goldTierSegmentRuleSet(),
          createdAt: "t0",
          updatedAt: "t0",
        },
      ],
    });

    await app.updateProfileProjection.execute({
      identifier: customer,
      field: "lifetime_value",
      value: 5000,
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });
    await app.recalculateComputedAttributes.execute({ identifier: customer });

    const recalculated = await app.recalculateMemberships.execute({
      identifier: customer,
      changed: ["attributes.clv_tier"],
    });
    if (!recalculated.ok) throw new Error("unreachable");
    expect(recalculated.value.results[0]?.isMember).toBe(true);
    expect(recalculated.value.results[0]?.inputs.get("attributes.clv_tier")).toBe("gold");
  });

  it("RebuildSegmentMembership and SegmentProjectionWorker rebuild the cache from history", async () => {
    const app = wire();
    await app.createSegment.execute({
      id: "high_value",
      name: "High value",
      ruleSet: highValueRuleSet(),
    });
    await app.updateProfileProjection.execute({
      identifier: customer,
      field: "lifetime_value",
      value: 5000,
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });
    await app.recalculateMemberships.execute({ identifier: customer });

    const rebuilt = await app.rebuildSegmentMembership.execute({
      identifier: customer,
      segmentId: "high_value",
    });
    if (!rebuilt.ok) throw new Error("unreachable");
    expect(rebuilt.value.membership?.status).toBe("entered");

    const worker = await app.segmentProjectionWorker.execute({});
    if (!worker.ok) throw new Error("unreachable");
    expect(worker.value.rebuilt).toBeGreaterThanOrEqual(1);
    expect(worker.value.failed).toBe(0);
  });

  it("SegmentMembershipWorker re-evaluates every known identifier against the full registered segment set", async () => {
    const app = wire();
    await app.createSegment.execute({
      id: "high_value",
      name: "High value",
      ruleSet: highValueRuleSet(),
    });
    await app.updateProfileProjection.execute({
      identifier: customer,
      field: "lifetime_value",
      value: 5000,
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });
    await app.recalculateMemberships.execute({ identifier: customer });

    const sweep = await app.segmentMembershipWorker.execute({});
    if (!sweep.ok) throw new Error("unreachable");
    expect(sweep.value.evaluated).toBe(1);
    expect(sweep.value.failed).toBe(0);
  });

  it("UpdateSegment bumps version and re-evaluation carries the new definitionVersion; DeleteSegment never cascades into membership/history", async () => {
    const app = wire();
    await app.createSegment.execute({
      id: "high_value",
      name: "High value",
      ruleSet: highValueRuleSet(),
    });
    await app.updateProfileProjection.execute({
      identifier: customer,
      field: "lifetime_value",
      value: 5000,
      source: "orders",
      confidence: "verified",
      occurredAt: clock.now().toISOString(),
    });
    await app.recalculateMemberships.execute({ identifier: customer });

    const updated = await app.updateSegment.execute({
      id: "high_value",
      expectedVersion: 1,
      ruleSet: {
        id: "high_value",
        version: 2,
        mode: "first_match",
        rules: [
          {
            id: "high-value-rule-v2",
            priority: 1,
            when: Expr.where("profile.lifetime_value", "gte", 1000),
            then: true,
          },
        ],
        fallback: false,
      },
    });
    expect(updated.ok).toBe(true);

    const recalculated = await app.recalculateMemberships.execute({ identifier: customer });
    if (!recalculated.ok) throw new Error("unreachable");
    expect(recalculated.value.results[0]?.definitionVersion).toBe(2);

    const deleted = await app.deleteSegment.execute({ id: "high_value", expectedVersion: 2 });
    expect(deleted.ok).toBe(true);

    const members = await app.getCustomerSegments.execute({ identifier: customer });
    if (!members.ok) throw new Error("unreachable");
    // Existing membership/history survive the definition's deletion — never cascaded.
    expect(members.value.segment.memberships.get("high_value")?.status).toBe("entered");
  });
});
