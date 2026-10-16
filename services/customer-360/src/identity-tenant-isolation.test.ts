import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { IdentifierType } from "@platform/tracking";
import { wireCustomer360 } from "./composition";
import { TENANT_A, TENANT_B } from "./test-support/tenants";

/**
 * ADR-0014 / WP-10 T10.3 — the identity graph is the one place a tenant-scoping bug is not merely a
 * leak but an irreversible corruption: a cross-tenant stitch or merge silently joins two merchants'
 * customer records into one cluster, and no code fix can un-join what later reads and writes have
 * already built on. These tests therefore drive the REAL composed paths (`ObserveIdentityLink`,
 * `MergeIdentities`, `SplitIdentity`, `ResolveIdentity`, `ObserveSession`, `MergeSession`,
 * `GetCustomerProfile` — the same use cases the e2e suite exercises, not a simplified fixture) and
 * use the collision that actually happens in production: the SAME identifier value observed under
 * two merchants (one shopper, one `email_hash`, two stores).
 */
function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-20T00:00:00.000Z") };
const NOW = clock.now().toISOString();

function wire() {
  return wireCustomer360({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

type App = ReturnType<typeof wire>;

const SHARED_EMAIL = { type: "email_hash" as const, value: "hash-shared-shopper" };

async function stitch(
  app: App,
  tenantId: string,
  visitorId: string,
  identifiers: readonly { type: IdentifierType; value: string }[],
): Promise<void> {
  const result = await app.observeIdentityLink.execute({
    tenantId,
    visitorId,
    identifiers,
    observedAt: NOW,
    source: "checkout",
  });
  if (!result.ok) throw result.error;
}

async function clusterMembers(
  app: App,
  tenantId: string,
  identifier: { type: IdentifierType; value: string },
): Promise<readonly string[]> {
  const resolved = await app.resolveIdentity.execute({ tenantId, ...identifier });
  if (!resolved.ok) throw resolved.error;
  return (resolved.value.cluster?.resolved.members ?? []).map((m) => `${m.type}:${m.value}`);
}

describe("Customer 360 identity graph — tenant isolation (ADR-0014)", () => {
  it("never stitches two tenants' visitors together through a shared identifier", async () => {
    const app = wire();
    // The same shopper (same email hash) is a customer of both merchants, under different visitors.
    await stitch(app, TENANT_A, "visitor-a", [SHARED_EMAIL]);
    await stitch(app, TENANT_B, "visitor-b", [SHARED_EMAIL]);

    const inA = await clusterMembers(app, TENANT_A, { type: "visitor_id", value: "visitor-a" });
    const inB = await clusterMembers(app, TENANT_B, { type: "visitor_id", value: "visitor-b" });

    expect([...inA].sort()).toEqual(["email_hash:hash-shared-shopper", "visitor_id:visitor-a"]);
    expect([...inB].sort()).toEqual(["email_hash:hash-shared-shopper", "visitor_id:visitor-b"]);
    // Had the graph been shared, each cluster would also contain the other tenant's visitor.
    expect(inA).not.toContain("visitor_id:visitor-b");
    expect(inB).not.toContain("visitor_id:visitor-a");
  });

  it("does not resolve an anonymous visitor in one tenant to a customer that only exists in another", async () => {
    const app = wire();
    // Tenant B knows this visitor id as a customer (identified by email + customer id) …
    await stitch(app, TENANT_B, "visitor-shared-id", [
      SHARED_EMAIL,
      { type: "customer_id", value: "cust-of-b" },
    ]);

    // … tenant A has only ever seen the same visitor id anonymously (no identifiers at all).
    await stitch(app, TENANT_A, "visitor-shared-id", []);

    expect(
      await clusterMembers(app, TENANT_A, { type: "visitor_id", value: "visitor-shared-id" }),
    ).toEqual([]);
    // The B customer's email resolves only inside B, and never picks up the anonymous A visitor.
    const emailInA = await clusterMembers(app, TENANT_A, SHARED_EMAIL);
    expect(emailInA).toEqual([]);
    const emailInB = await clusterMembers(app, TENANT_B, SHARED_EMAIL);
    expect(emailInB).toContain("customer_id:cust-of-b");
  });

  it("scopes a manual merge to its own tenant — the merged edge never reaches the other tenant's graph", async () => {
    const app = wire();
    await stitch(app, TENANT_A, "visitor-a", []);
    await stitch(app, TENANT_B, "visitor-b", [{ type: "customer_id", value: "cust-b" }]);

    const merge = await app.mergeIdentities.execute({
      tenantId: TENANT_A,
      subject: { type: "visitor_id", value: "visitor-a" },
      related: SHARED_EMAIL,
      reason: "confirmed at login",
      actor: "operator-a",
    });
    expect(merge.ok).toBe(true);

    expect(
      await clusterMembers(app, TENANT_A, { type: "visitor_id", value: "visitor-a" }),
    ).toContain("email_hash:hash-shared-shopper");
    // Tenant B never sees A's merged edge, from either end.
    expect(await clusterMembers(app, TENANT_B, SHARED_EMAIL)).toEqual([]);
    expect(await clusterMembers(app, TENANT_B, { type: "visitor_id", value: "visitor-a" })).toEqual(
      [],
    );
    // And the merge decision belongs to A's timeline only.
    const timelineA = await app.getIdentityTimeline.execute({
      tenantId: TENANT_A,
      identifier: SHARED_EMAIL,
    });
    const timelineB = await app.getIdentityTimeline.execute({
      tenantId: TENANT_B,
      identifier: SHARED_EMAIL,
    });
    if (!timelineA.ok || !timelineB.ok) throw new Error("unreachable");
    expect(timelineA.value.entries.some((e) => e.kind === "merged")).toBe(true);
    expect(timelineB.value.entries).toEqual([]);
  });

  it("cannot split, and so cannot retract, an edge that was only observed in another tenant", async () => {
    const app = wire();
    await stitch(app, TENANT_B, "visitor-b", [SHARED_EMAIL]);
    await stitch(app, TENANT_A, "visitor-a", [SHARED_EMAIL]);

    const observedInB = {
      fromType: "visitor_id" as const,
      fromValue: "visitor-b",
      toType: "email_hash" as const,
      toValue: SHARED_EMAIL.value,
      confidence: "deterministic" as const,
      observedAt: NOW,
      source: "checkout",
    };
    const attempt = await app.splitIdentity.execute({
      tenantId: TENANT_A,
      edge: observedInB,
      reason: "wrong tenant",
      actor: "operator-a",
    });
    expect(attempt.ok).toBe(false);

    // B's link is untouched by the failed attempt.
    expect(
      await clusterMembers(app, TENANT_B, { type: "visitor_id", value: "visitor-b" }),
    ).toContain("email_hash:hash-shared-shopper");

    // A split issued in its own tenant retracts there and only there.
    const split = await app.splitIdentity.execute({
      tenantId: TENANT_B,
      edge: observedInB,
      reason: "shared device",
      actor: "operator-b",
    });
    expect(split.ok).toBe(true);
    expect(
      await clusterMembers(app, TENANT_B, { type: "visitor_id", value: "visitor-b" }),
    ).not.toContain("email_hash:hash-shared-shopper");
    expect(
      await clusterMembers(app, TENANT_A, { type: "visitor_id", value: "visitor-a" }),
    ).toContain("email_hash:hash-shared-shopper");
  });

  it("does not merge profile fields across tenants when an identifier is shared", async () => {
    const app = wire();
    await stitch(app, TENANT_A, "visitor-a", [SHARED_EMAIL]);
    await stitch(app, TENANT_B, "visitor-b", [SHARED_EMAIL]);
    for (const [tenantId, value] of [
      [TENANT_A, "a-only@example.com"],
      [TENANT_B, "b-only@example.com"],
    ] as const) {
      const update = await app.updateProfileProjection.execute({
        tenantId,
        identifier: SHARED_EMAIL,
        field: "contact",
        value,
        source: "orders",
        confidence: "verified",
        occurredAt: NOW,
      });
      expect(update.ok).toBe(true);
    }

    const readA = await app.getCustomerProfile.execute({
      tenantId: TENANT_A,
      identifier: { type: "visitor_id", value: "visitor-a" },
      now: NOW,
    });
    if (!readA.ok) throw readA.error;
    expect(readA.value.profile?.fields.get("contact")?.value).toBe("a-only@example.com");
    expect(readA.value.mergedFrom.map((m) => m.value)).not.toContain("visitor-b");
  });

  it("refuses to merge a session from another tenant, and leaves both tenants' journeys untouched", async () => {
    const app = wire();
    const observe = async (tenantId: string, sessionId: string, visitorId: string) => {
      const result = await app.observeSession.execute({
        tenantId,
        sessionId,
        visitorId,
        occurredAt: "2026-07-20T00:00:00.000Z",
      });
      if (!result.ok) throw result.error;
    };
    await observe(TENANT_A, "sess-a", "visitor-a");
    await observe(TENANT_B, "sess-b", "visitor-b");

    const merge = await app.mergeSession.execute({
      tenantId: TENANT_A,
      fromSessionId: "sess-a",
      toSessionId: "sess-b", // exists only in tenant B
      reason: "cross-tenant attempt",
      actor: "operator-a",
    });
    expect(merge.ok).toBe(false);

    for (const [tenantId, visitorId] of [
      [TENANT_A, "visitor-a"],
      [TENANT_B, "visitor-b"],
    ] as const) {
      const journey = await app.getJourneyTimeline.execute({ tenantId, visitorId });
      if (!journey.ok) throw journey.error;
      expect(journey.value.entries.filter((e) => e.kind === "transition")).toEqual([]);
    }
  });

  it("never rolls over, closes or resumes another tenant's session for a colliding visitor id", async () => {
    const app = wire();
    const first = await app.observeSession.execute({
      tenantId: TENANT_B,
      sessionId: "sess-b",
      visitorId: "visitor-shared-id",
      occurredAt: "2026-07-20T00:00:00.000Z",
    });
    expect(first.ok).toBe(true);

    // Two hours later the same visitor id shows up under tenant A. Were sessions shared across
    // tenants this would time out B's session (a rollover) instead of opening a fresh one.
    const inA = await app.observeSession.execute({
      tenantId: TENANT_A,
      sessionId: "sess-a",
      visitorId: "visitor-shared-id",
      occurredAt: "2026-07-20T02:00:00.000Z",
    });
    if (!inA.ok) throw inA.error;
    expect(inA.value).toEqual({ sessionId: "sess-a", opened: true, rolledOverFrom: undefined });

    const stateB = await app.getJourneyState.execute({
      tenantId: TENANT_B,
      visitorId: "visitor-shared-id",
    });
    if (!stateB.ok) throw stateB.error;
    expect(stateB.value.state.currentSessionId).toBe("sess-b");
    expect(stateB.value.state.sessionCount).toBe(1);
  });
});
