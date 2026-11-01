import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { ONLINE_STORE_PUBLISHED_EVENTS } from "../infrastructure/event-translator";
import { AccessChanged, PreferencesUpdated, ThemePublished } from "./events";

const props = {
  eventId: "e-1",
  aggregateId: UniqueEntityId.from("4b0e2f0a-6f4f-4a0c-9c5e-0d7b8c2f6a11"),
  occurredAt: new Date("2026-10-27T10:00:00.000Z"),
};

describe("online-store events", () => {
  it("can all be constructed (preflight F9) and carry no tenant and no secret", () => {
    const published = new ThemePublished(props, { releaseNumber: 3 });
    const access = new AccessChanged(props, { locked: true });
    const preferences = new PreferencesUpdated(props);
    expect(published.data).toEqual({ releaseNumber: 3 });
    expect(access.data).toEqual({ locked: true });
    expect(preferences.data).toEqual({});
    for (const event of [published, access, preferences]) {
      expect(JSON.stringify(event.data)).not.toMatch(/tenant|password|hash|token/i);
    }
  });

  it("publishes exactly the three event names the relay needs topics for", () => {
    expect([
      new ThemePublished(props, { releaseNumber: 1 }).eventName,
      new AccessChanged(props, { locked: false }).eventName,
      new PreferencesUpdated(props).eventName,
    ]).toEqual(ONLINE_STORE_PUBLISHED_EVENTS);
  });
});
