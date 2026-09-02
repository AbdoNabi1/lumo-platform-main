import { describe, expect, it } from "vitest";
import {
  closeSession,
  openSession,
  recordActivity,
  type CustomerSession,
} from "./customer-session";

const BASE = {
  sessionId: "sess-1",
  visitorId: "visitor-1",
  deviceId: "device-1",
  startedAt: "2026-07-21T00:00:00.000Z",
};

describe("openSession", () => {
  it("starts an open session with pageCount 1 and version 1", () => {
    const session = openSession(BASE);
    expect(session.status).toBe("open");
    expect(session.pageCount).toBe(1);
    expect(session.version).toBe(1);
    expect(session.lastActivityAt).toBe(BASE.startedAt);
  });
});

describe("recordActivity", () => {
  it("advances lastActivityAt, bumps pageCount and version", () => {
    const session = openSession(BASE);
    const result = recordActivity(session, "2026-07-21T00:05:00.000Z");
    expect(result.applied).toBe(true);
    expect(result.session.lastActivityAt).toBe("2026-07-21T00:05:00.000Z");
    expect(result.session.pageCount).toBe(2);
    expect(result.session.version).toBe(2);
  });

  it("rejects an activity at-or-before lastActivityAt (freshness guard) without mutating the input", () => {
    const session = openSession(BASE);
    const result = recordActivity(session, BASE.startedAt);
    expect(result.applied).toBe(false);
    expect(result.session).toBe(session);
  });

  it("rejects a strictly earlier (replayed) activity", () => {
    const session = recordActivity(openSession(BASE), "2026-07-21T00:05:00.000Z").session;
    const result = recordActivity(session, "2026-07-21T00:01:00.000Z");
    expect(result.applied).toBe(false);
    expect(result.session).toEqual(session);
  });

  it("never mutates the input session", () => {
    const session = openSession(BASE);
    const before = { ...session };
    recordActivity(session, "2026-07-21T00:05:00.000Z");
    expect(session).toEqual(before);
  });
});

describe("closeSession", () => {
  it("sets status closed, closedAt, closeReason, and bumps version", () => {
    const session = openSession(BASE);
    const closed = closeSession(session, "timeout", "2026-07-21T00:30:00.000Z");
    expect(closed.status).toBe("closed");
    expect(closed.closedAt).toBe("2026-07-21T00:30:00.000Z");
    expect(closed.closeReason).toBe("timeout");
    expect(closed.version).toBe(session.version + 1);
  });

  it("never mutates the input session", () => {
    const session = openSession(BASE);
    const before: CustomerSession = { ...session };
    closeSession(session, "manual_logout", "2026-07-21T00:10:00.000Z");
    expect(session).toEqual(before);
  });
});
