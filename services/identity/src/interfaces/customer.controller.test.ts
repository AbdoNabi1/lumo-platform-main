import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireIdentity } from "../composition";

const clock: Clock = { now: () => new Date("2026-11-24T00:00:00.000Z") };
const TENANT = "tenant-a";

function wire() {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
  };
  return wireIdentity({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

describe("CustomerController — staff profile methods", () => {
  it("createCustomer → 201 {customerId}; a duplicate email → 409; invalid input → 422", async () => {
    expect.hasAssertions();
    const { customers } = wire();

    const created = await customers.createCustomer({
      tenantId: TENANT,
      name: "Mona",
      email: "mona@example.com",
      phone: "010 1234-5678",
      language: "ar",
      note: "vip",
      tags: ["b", "a"],
      marketingEmail: true,
      marketingSms: true,
    });
    const duplicate = await customers.createCustomer({
      tenantId: TENANT,
      name: "Mona",
      email: "MONA@example.com",
    });
    const invalid = await customers.createCustomer({ tenantId: TENANT, name: "", email: "x" });

    expect(created.status).toBe(201);
    expect(created.body).toEqual({ customerId: expect.any(String) });
    expect(duplicate.status).toBe(409);
    expect(invalid.status).toBe(422);
  });

  it("updateCustomerProfile → 200; {} → 422; unknown → 404", async () => {
    expect.hasAssertions();
    const { customers } = wire();
    const { customerId } = (
      await customers.createCustomer({ tenantId: TENANT, name: "A", email: "a@example.com" })
    ).body as { customerId: string };

    const updated = await customers.updateCustomerProfile({
      tenantId: TENANT,
      customerId,
      name: "B",
      phone: "01012345678",
    });
    const empty = await customers.updateCustomerProfile({ tenantId: TENANT, customerId });
    const unknown = await customers.updateCustomerProfile({
      tenantId: TENANT,
      customerId: "nope",
      name: "B",
    });

    expect(updated).toEqual({ status: 200, body: { customerId } });
    expect(empty.status).toBe(422);
    expect(unknown.status).toBe(404);
  });

  it("setCustomerNote, setCustomerTags, changeMarketingConsent → 200 with their bodies; unknown → 404", async () => {
    expect.hasAssertions();
    const { customers } = wire();
    const { customerId } = (
      await customers.createCustomer({ tenantId: TENANT, name: "A", email: "a@example.com" })
    ).body as { customerId: string };

    const note = await customers.setCustomerNote({ tenantId: TENANT, customerId, note: " hi " });
    const tags = await customers.setCustomerTags({
      tenantId: TENANT,
      customerId,
      tags: ["VIP", "Cairo"],
    });
    const consent = await customers.changeMarketingConsent({
      tenantId: TENANT,
      customerId,
      sms: true,
    });
    const missing = await customers.setCustomerNote({
      tenantId: TENANT,
      customerId: "nope",
      note: "x",
    });

    expect(note).toEqual({ status: 200, body: { customerId, note: "hi" } });
    expect(tags).toEqual({ status: 200, body: { customerId, tags: ["Cairo", "VIP"] } });
    expect(consent).toEqual({ status: 200, body: { customerId, email: false, sms: true } });
    expect(missing.status).toBe(404);
  });

  it("customerAnnotations → 200 items in input order; empty list → 422", async () => {
    expect.hasAssertions();
    const { customers } = wire();
    const first = (
      await customers.createCustomer({
        tenantId: TENANT,
        name: "A",
        email: "a@example.com",
        note: "n",
        tags: ["x"],
      })
    ).body as { customerId: string };
    const second = (
      await customers.createCustomer({ tenantId: TENANT, name: "B", email: "b@example.com" })
    ).body as { customerId: string };

    const response = await customers.customerAnnotations({
      tenantId: TENANT,
      customerIds: [second.customerId, "unknown", first.customerId],
    });
    const empty = await customers.customerAnnotations({ tenantId: TENANT, customerIds: [] });

    expect(response).toEqual({
      status: 200,
      body: {
        items: [
          { customerId: second.customerId, note: null, tags: [] },
          { customerId: first.customerId, note: "n", tags: ["x"] },
        ],
      },
    });
    expect(empty.status).toBe(422);
  });
});
