import { describe, expect, it } from "vitest";
import {
  advanceableNotificationStatusesFrom,
  canQueueFrom,
  canRetryFrom,
  canSendFrom,
  NOTIFICATION_LIFECYCLE_TRANSITIONS,
} from "./notification-lifecycle";

describe("canQueueFrom", () => {
  it("is true only at created", () => {
    expect(canQueueFrom("created")).toBe(true);
  });

  it("is false everywhere else", () => {
    expect(canQueueFrom("queued")).toBe(false);
    expect(canQueueFrom("sent")).toBe(false);
    expect(canQueueFrom("failed")).toBe(false);
    expect(canQueueFrom("retrying")).toBe(false);
    expect(canQueueFrom("delivered")).toBe(false);
  });
});

describe("canSendFrom", () => {
  it("is true at queued and retrying", () => {
    expect(canSendFrom("queued")).toBe(true);
    expect(canSendFrom("retrying")).toBe(true);
  });

  it("is false everywhere else", () => {
    expect(canSendFrom("created")).toBe(false);
    expect(canSendFrom("sent")).toBe(false);
    expect(canSendFrom("failed")).toBe(false);
    expect(canSendFrom("delivered")).toBe(false);
  });
});

describe("canRetryFrom", () => {
  it("is true only at failed", () => {
    expect(canRetryFrom("failed")).toBe(true);
  });

  it("is false everywhere else", () => {
    expect(canRetryFrom("created")).toBe(false);
    expect(canRetryFrom("queued")).toBe(false);
    expect(canRetryFrom("sent")).toBe(false);
    expect(canRetryFrom("retrying")).toBe(false);
  });
});

describe("advanceableNotificationStatusesFrom", () => {
  it("offers only cancelled at created — queued is covered by the dedicated queue action", () => {
    expect(advanceableNotificationStatusesFrom("created")).toEqual(["cancelled"]);
  });

  it("offers failed and cancelled at queued — sent is covered by the dedicated send action", () => {
    expect(advanceableNotificationStatusesFrom("queued")).toEqual(["failed", "cancelled"]);
  });

  it("offers both targets at sent — no dedicated action moves out of sent", () => {
    expect(advanceableNotificationStatusesFrom("sent")).toEqual(["delivered", "failed"]);
  });

  it("offers dead_letter and expired at failed — retrying is covered by the dedicated retry action", () => {
    expect(advanceableNotificationStatusesFrom("failed")).toEqual(["dead_letter", "expired"]);
  });

  it("offers failed, dead_letter, expired at retrying — sent is covered by the dedicated send action", () => {
    expect(advanceableNotificationStatusesFrom("retrying")).toEqual([
      "failed",
      "dead_letter",
      "expired",
    ]);
  });

  it("returns an empty array for every terminal status", () => {
    expect(advanceableNotificationStatusesFrom("delivered")).toEqual([]);
    expect(advanceableNotificationStatusesFrom("dead_letter")).toEqual([]);
    expect(advanceableNotificationStatusesFrom("cancelled")).toEqual([]);
    expect(advanceableNotificationStatusesFrom("expired")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(advanceableNotificationStatusesFrom("not-a-real-status")).toEqual([]);
  });

  it("every status in the hand-kept table has an entry (no key silently missing)", () => {
    for (const status of Object.keys(NOTIFICATION_LIFECYCLE_TRANSITIONS)) {
      expect(() => advanceableNotificationStatusesFrom(status)).not.toThrow();
    }
  });
});
