import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCheckout } from "./composition";

describe("wireCheckout — Part 3 recovery surface", () => {
  it("answers an empty abandoned list and a LINK_INVALID 404 for an unknown token", async () => {
    let n = 0;
    const { checkout } = wireCheckout({
      serializer: new InMemoryEventSerializer(),
      idGenerator: { generate: () => `id-${(n += 1)}` },
      clock: { now: () => new Date("2026-10-18T12:00:00.000Z") },
    });
    expect(await checkout.listAbandoned({ tenantId: "t" })).toEqual({
      status: 200,
      body: { items: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });
    const unknown = await checkout.resolveLink({ tenantId: "t", token: "x".repeat(43) });
    expect(unknown.status).toBe(404);
    expect((unknown.body as { message: string }).message).toMatch(/^LINK_INVALID:/);
  });
});
