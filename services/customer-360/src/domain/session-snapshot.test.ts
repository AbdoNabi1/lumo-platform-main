import { describe, expect, it } from "vitest";
import { closeSession, openSession, recordActivity } from "./customer-session";
import { fromSnapshot, toSnapshot } from "./session-snapshot";

describe("session snapshot round-trip", () => {
  it("fromSnapshot(toSnapshot(session)) reconstructs an equivalent session", () => {
    const session = recordActivity(
      openSession({
        sessionId: "sess-1",
        visitorId: "visitor-1",
        deviceId: "device-1",
        journeyId: "journey-1",
        source: "web",
        startedAt: "2026-07-21T00:00:00.000Z",
      }),
      "2026-07-21T00:05:00.000Z",
    ).session;

    const snapshot = toSnapshot(session, "activity", "2026-07-21T00:05:00.000Z");
    expect(fromSnapshot(snapshot)).toEqual(session);
  });

  it("captures closed state faithfully", () => {
    const session = closeSession(
      openSession({ sessionId: "sess-2", visitorId: "visitor-2", startedAt: "t0" }),
      "manual_logout",
      "t1",
    );
    const snapshot = toSnapshot(session, "closed", "t1");
    expect(snapshot.status).toBe("closed");
    expect(snapshot.closeReason).toBe("manual_logout");
    expect(fromSnapshot(snapshot)).toEqual(session);
  });
});
