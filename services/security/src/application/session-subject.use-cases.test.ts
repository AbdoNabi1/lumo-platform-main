import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity, type WiredSecurity } from "../composition";
import type { SessionSubject } from "./session.use-cases";

/**
 * `IntrospectSessionSubject` (T5.17) at the controller boundary — the session → principal →
 * Identity-subject hop every customer-scoped route derives its `customerRef` from. Driven through a
 * REAL `wireSecurity()` composition (in-memory branch), same style as `resolution.use-cases.test.ts`.
 *
 * The behaviour under test is mostly *negative*: every unresolvable case must produce the SAME
 * inactive answer, because an endpoint that distinguished "no such session" from "expired session"
 * from "suspended principal" would be an existence oracle for session ids and customer accounts.
 */

let counter = 0;
function sequentialIds(): IdGenerator {
  return { generate: () => `id-${(counter += 1)}` };
}

const NOW = new Date("2026-08-31T00:00:00.000Z");
let now = NOW;
const clock: Clock = { now: () => now };

function app(): WiredSecurity {
  now = NOW;
  return wireSecurity({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    // The Identity subjects `RegisterPrincipal` verifies a human principal against.
    knownSubjects: ["customer-1", "customer-2"],
  });
}

const subject = (r: { body: unknown }): SessionSubject => r.body as SessionSubject;

/** Registers a human principal for `customer-1` and establishes a session for it. */
async function sessionFor(
  wired: WiredSecurity,
  subjectRef = "customer-1",
  ttlSeconds = 3600,
): Promise<string> {
  await wired.security.registerPrincipal({
    externalId: subjectRef,
    kind: "human",
    displayName: subjectRef,
    subjectRef,
  });
  const established = await wired.security.establishSession({
    principalExternalId: subjectRef,
    refreshFingerprint: "fp-1",
    ttlSeconds,
  });
  expect(established.status).toBeLessThan(300);
  return (established.body as { id: string }).id;
}

describe("IntrospectSessionSubject (T5.17)", () => {
  it("resolves a valid session to its Identity subject, never to a Security-internal id", async () => {
    const wired = app();
    const sessionId = await sessionFor(wired);

    const resolved = subject(await wired.security.introspectSessionSubject({ sessionId }));

    expect(resolved.active).toBe(true);
    expect(resolved.subjectRef).toBe("customer-1");
    expect(resolved.principalExternalId).toBe("customer-1");
    expect(resolved.sessionId).toBe(sessionId);
    expect(resolved.expiresAt).toBe("2026-08-31T01:00:00.000Z");
  });

  it("returns flat primitives only — no Session/Principal aggregate reaches the boundary", async () => {
    const wired = app();
    const sessionId = await sessionFor(wired);

    const resolved = subject(await wired.security.introspectSessionSubject({ sessionId }));

    // `Entity` exposes `props`/`_id`/`_domainEvents`/`_version` at runtime; none may be present.
    expect(Object.keys(resolved).sort()).toEqual([
      "active",
      "expiresAt",
      "principalExternalId",
      "sessionId",
      "subjectRef",
    ]);
  });

  it("answers 200 + inactive (never 404) for an unknown session id", async () => {
    const wired = app();
    const response = await wired.security.introspectSessionSubject({ sessionId: "no-such-id" });

    expect(response.status).toBe(200);
    expect(subject(response)).toEqual({
      active: false,
      sessionId: null,
      principalExternalId: null,
      subjectRef: null,
      expiresAt: null,
    });
  });

  it("treats an empty session id as inactive without hitting the repository", async () => {
    const wired = app();
    expect(subject(await wired.security.introspectSessionSubject({ sessionId: "" })).active).toBe(
      false,
    );
  });

  it("goes inactive once the session has expired (sliding-window TTL enforcement)", async () => {
    const wired = app();
    const sessionId = await sessionFor(wired, "customer-1", 60);

    expect(subject(await wired.security.introspectSessionSubject({ sessionId })).active).toBe(true);
    now = new Date(NOW.getTime() + 61_000);
    expect(subject(await wired.security.introspectSessionSubject({ sessionId })).active).toBe(false);
  });

  it("goes inactive immediately after RevokeSession — logout takes effect on the next request", async () => {
    const wired = app();
    const sessionId = await sessionFor(wired);

    await wired.security.revokeSession({ sessionId });

    const resolved = subject(await wired.security.introspectSessionSubject({ sessionId }));
    expect(resolved.active).toBe(false);
    expect(resolved.subjectRef).toBeNull();
  });

  it("goes inactive after RevokeAllSessions (sign out everywhere)", async () => {
    const wired = app();
    const sessionId = await sessionFor(wired);

    await wired.security.revokeAllSessions({ principalExternalId: "customer-1" });

    expect(subject(await wired.security.introspectSessionSubject({ sessionId })).active).toBe(false);
  });

  it("goes inactive when the principal is suspended or disabled, even while the session is unexpired", async () => {
    const wired = app();
    const sessionId = await sessionFor(wired);

    await wired.security.transitionPrincipal({ externalId: "customer-1", to: "suspended" });

    expect(subject(await wired.security.introspectSessionSubject({ sessionId })).active).toBe(false);
  });

  it("refuses to resolve a NON-human principal's session to a customer identity", async () => {
    const wired = app();
    await wired.security.registerPrincipal({
      externalId: "svc-robot",
      kind: "service_account",
      displayName: "Robot",
    });
    const established = await wired.security.establishSession({
      principalExternalId: "svc-robot",
      refreshFingerprint: "fp-svc",
      ttlSeconds: 3600,
    });
    const sessionId = (established.body as { id: string }).id;

    const resolved = subject(await wired.security.introspectSessionSubject({ sessionId }));
    expect(resolved.active).toBe(false);
    expect(resolved.subjectRef).toBeNull();
  });

  it("survives a refresh — RefreshSession extends the window, the subject is unchanged", async () => {
    const wired = app();
    const sessionId = await sessionFor(wired, "customer-1", 60);

    now = new Date(NOW.getTime() + 30_000);
    const refreshed = await wired.security.refreshSession({
      sessionId,
      newRefreshFingerprint: "fp-2",
      ttlSeconds: 3600,
    });
    expect(refreshed.status).toBeLessThan(300);

    now = new Date(NOW.getTime() + 120_000);
    const resolved = subject(await wired.security.introspectSessionSubject({ sessionId }));
    expect(resolved.active).toBe(true);
    expect(resolved.subjectRef).toBe("customer-1");
  });

  it("never crosses customers — two sessions resolve to their own subjects only", async () => {
    const wired = app();
    const first = await sessionFor(wired, "customer-1");
    const second = await sessionFor(wired, "customer-2");

    expect(subject(await wired.security.introspectSessionSubject({ sessionId: first })).subjectRef)
      .toBe("customer-1");
    expect(subject(await wired.security.introspectSessionSubject({ sessionId: second })).subjectRef)
      .toBe("customer-2");
  });
});
