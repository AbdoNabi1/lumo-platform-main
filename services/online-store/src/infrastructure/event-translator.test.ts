import { describe, expect, it } from "vitest";
import { UniqueEntityId, type DomainEvent } from "@platform/domain";
import { AccessChanged, PreferencesUpdated, ThemePublished } from "../domain/events";
import { ONLINE_STORE_PUBLISHED_EVENTS, OnlineStoreEventTranslator } from "./event-translator";

const props = {
  eventId: "e-1",
  aggregateId: UniqueEntityId.from("4b0e2f0a-6f4f-4a0c-9c5e-0d7b8c2f6a11"),
  occurredAt: new Date("2026-10-27T10:00:00.000Z"),
};

describe("OnlineStoreEventTranslator", () => {
  const translator = new OnlineStoreEventTranslator();

  it("publishes exactly the three event names the relay needs topics for", () => {
    const events = [
      new ThemePublished(props, { releaseNumber: 1 }),
      new AccessChanged(props, { locked: false }),
      new PreferencesUpdated(props),
    ];
    expect(events.map((event) => translator.translate(event)?.type)).toEqual(
      ONLINE_STORE_PUBLISHED_EVENTS,
    );
  });

  it("describes an event at version 1 with its own data as the payload", () => {
    expect(translator.translate(new ThemePublished(props, { releaseNumber: 3 }))).toEqual({
      type: "online_store.theme.published",
      eventVersion: 1,
      aggregateType: "online_store",
      payload: { releaseNumber: 3 },
    });
  });

  it("ignores an event from another context", () => {
    expect(translator.translate({ eventName: "orders.order.placed" } as DomainEvent)).toBe(
      undefined,
    );
  });
});
