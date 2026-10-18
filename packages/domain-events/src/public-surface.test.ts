import { describe, expect, it } from "vitest";
import * as domainEvents from "./index";
import * as testing from "./testing";

describe("@platform/domain-events public surface", () => {
  it("exposes the envelope tenant helpers, topic helpers and the production serializer", () => {
    expect(Object.keys(domainEvents).sort()).toEqual([
      "EVENT_TYPE_PATTERN",
      "JsonEventSerializer",
      "MissingEnvelopeTenantError",
      "readEnvelopeTenant",
      "requireEnvelopeTenant",
      "topicFor",
    ]);
  });

  it("keeps the test-only serializer out of the production entry point", () => {
    expect(domainEvents).not.toHaveProperty("InMemoryEventSerializer");
    expect(testing.InMemoryEventSerializer).toBeTypeOf("function");
  });

  it("ships both serializers on the same wire content type", () => {
    expect(new domainEvents.JsonEventSerializer().contentType).toBe(
      new testing.InMemoryEventSerializer().contentType,
    );
  });
});
