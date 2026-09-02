import { describe, expect, it } from "vitest";
import { closeSession, openSession, recordActivity } from "./customer-session";
import type { SessionTransition } from "./session-transition";
import { isActive, journeySegments, journeyState, sessionDuration } from "./session-views";

describe("sessionDuration", () => {
  it("measures start to lastActivityAt for an open session", () => {
    const session = recordActivity(
      openSession({ sessionId: "s1", visitorId: "v1", startedAt: "2026-07-21T00:00:00.000Z" }),
      "2026-07-21T00:05:00.000Z",
    ).session;
    expect(sessionDuration(session)).toBe(5 * 60 * 1000);
  });

  it("measures start to closedAt for a closed session", () => {
    const session = closeSession(
      openSession({ sessionId: "s1", visitorId: "v1", startedAt: "2026-07-21T00:00:00.000Z" }),
      "timeout",
      "2026-07-21T00:30:00.000Z",
    );
    expect(sessionDuration(session)).toBe(30 * 60 * 1000);
  });
});

describe("isActive", () => {
  it("is false once closed regardless of timing", () => {
    const session = closeSession(
      openSession({ sessionId: "s1", visitorId: "v1", startedAt: "t0" }),
      "timeout",
      "t1",
    );
    expect(isActive(session, "t1", 1_000_000)).toBe(false);
  });

  it("is true when open and within the idle window", () => {
    const session = openSession({
      sessionId: "s1",
      visitorId: "v1",
      startedAt: "2026-07-21T00:00:00.000Z",
    });
    expect(isActive(session, "2026-07-21T00:10:00.000Z", 30 * 60 * 1000)).toBe(true);
  });

  it("is false when open but past the idle window (stored status disagrees with reality)", () => {
    const session = openSession({
      sessionId: "s1",
      visitorId: "v1",
      startedAt: "2026-07-21T00:00:00.000Z",
    });
    expect(isActive(session, "2026-07-21T01:00:00.000Z", 30 * 60 * 1000)).toBe(false);
  });
});

describe("journeySegments", () => {
  it("computes the gap between a closed session and the session it opened into", () => {
    const from = closeSession(
      openSession({ sessionId: "s1", visitorId: "v1", startedAt: "2026-07-21T00:00:00.000Z" }),
      "timeout",
      "2026-07-21T00:30:00.000Z",
    );
    const to = openSession({
      sessionId: "s2",
      visitorId: "v1",
      startedAt: "2026-07-21T02:00:00.000Z",
    });
    const transition: SessionTransition = {
      id: "t1",
      kind: "timed_out",
      visitorId: "v1",
      fromSessionId: "s1",
      toSessionId: "s2",
      occurredAt: "2026-07-21T02:00:00.000Z",
    };

    const [segment] = journeySegments([from, to], [transition]);
    expect(segment?.gapMs).toBe(90 * 60 * 1000);
  });

  it("reports gapMs as undefined when an endpoint session is missing from the supplied set", () => {
    const to = openSession({ sessionId: "s2", visitorId: "v1", startedAt: "t1" });
    const transition: SessionTransition = {
      id: "t1",
      kind: "timed_out",
      visitorId: "v1",
      fromSessionId: "s1",
      toSessionId: "s2",
      occurredAt: "t1",
    };
    const [segment] = journeySegments([to], [transition]);
    expect(segment?.gapMs).toBeUndefined();
  });
});

describe("journeyState", () => {
  it("reports zero-session state for an empty journey", () => {
    expect(journeyState("v1", [], [])).toEqual({
      visitorId: "v1",
      sessionCount: 0,
      identified: false,
    });
  });

  it("picks the most-recently-active open session as current", () => {
    const older = closeSession(
      openSession({ sessionId: "s1", visitorId: "v1", startedAt: "2026-07-21T00:00:00.000Z" }),
      "timeout",
      "2026-07-21T00:30:00.000Z",
    );
    const current = openSession({
      sessionId: "s2",
      visitorId: "v1",
      startedAt: "2026-07-21T02:00:00.000Z",
    });

    const state = journeyState("v1", [older, current], []);
    expect(state.currentSessionId).toBe("s2");
    expect(state.sessionCount).toBe(2);
    expect(state.firstSeenAt).toBe("2026-07-21T00:00:00.000Z");
  });

  it("reports no current session when the most recently active one is closed", () => {
    const closed = closeSession(
      openSession({ sessionId: "s1", visitorId: "v1", startedAt: "t0" }),
      "manual_logout",
      "t1",
    );
    const state = journeyState("v1", [closed], []);
    expect(state.currentSessionId).toBeUndefined();
  });

  it("is identified only after an anonymous_to_identified transition is present", () => {
    const session = openSession({ sessionId: "s1", visitorId: "v1", startedAt: "t0" });
    const withoutIdentity = journeyState("v1", [session], []);
    expect(withoutIdentity.identified).toBe(false);

    const transition: SessionTransition = {
      id: "t1",
      kind: "anonymous_to_identified",
      visitorId: "v1",
      fromSessionId: "s1",
      occurredAt: "t1",
    };
    const withIdentity = journeyState("v1", [session], [transition]);
    expect(withIdentity.identified).toBe(true);
  });
});
