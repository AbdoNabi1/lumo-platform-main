import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireIdentity } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };

function wire() {
  return wireIdentity({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

async function newCustomerId(
  app: ReturnType<typeof wire>,
  email = "alice@example.com",
): Promise<string> {
  const registered = await app.customers.register({ email, name: "Alice" });
  expect(registered.status).toBe(201);
  return (registered.body as { customerId: string }).customerId;
}

describe("identity (end to end)", () => {
  it("registers a customer, adds an address, and changes consent, publishing the events", async () => {
    const app = wire();
    const customerId = await newCustomerId(app);

    const address = await app.customers.addAddress({
      customerId,
      line1: "1 Main St",
      city: "Town",
      postalCode: "12345",
      country: "US",
    });
    expect(address.status).toBe(201);

    const consent = await app.customers.changeConsent({
      customerId,
      scope: "marketing",
      granted: true,
    });
    expect(consent.status).toBe(200);
    expect((consent.body as { granted: boolean }).granted).toBe(true);

    expect(await app.drainOutbox()).toBe(2); // registered + consent_changed
    expect(app.deliveredEventTypes).toEqual([
      "identity.customer.registered",
      "identity.customer.consent_changed",
    ]);
  });

  it("rejects a duplicate email (409)", async () => {
    const app = wire();
    await newCustomerId(app, "dupe@example.com");
    const response = await app.customers.register({ email: "dupe@example.com", name: "Bob" });
    expect(response.status).toBe(409);
  });

  it("rejects an invalid email (422)", async () => {
    const app = wire();
    const response = await app.customers.register({ email: "not-an-email", name: "Alice" });
    expect(response.status).toBe(422);
  });

  it("returns 404 when adding an address to an unknown customer", async () => {
    const app = wire();
    const response = await app.customers.addAddress({
      customerId: "missing",
      line1: "1 Main St",
      city: "Town",
      postalCode: "12345",
      country: "US",
    });
    expect(response.status).toBe(404);
  });

  it("rejects an unknown consent scope (422)", async () => {
    const app = wire();
    const customerId = await newCustomerId(app);
    const response = await app.customers.changeConsent({
      customerId,
      scope: "telepathy",
      granted: true,
    });
    expect(response.status).toBe(422);
  });
});
