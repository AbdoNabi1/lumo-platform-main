import { beforeEach, describe, expect, it } from "vitest";
import { wireLeads } from "../composition";
import { fakeShop, fixedClock, sequentialIds, validInput } from "../testing/fixtures";

beforeEach(() => {
  expect.hasAssertions();
});

function controllerFor(shop = fakeShop()) {
  return wireLeads({ clock: fixedClock(), idGenerator: sequentialIds(), shop }).controller;
}

describe("LeadsController", () => {
  it("submit answers 201 with { leadId, eventId, emission }", async () => {
    const response = await controllerFor().submit(validInput());
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      leadId: "01930000-0000-7000-8000-000000000001",
      eventId: "lead_01930000-0000-7000-8000-000000000001",
      emission: "emit",
    });
  });

  it("a store shop answers 409 with the BUSINESS_RULE envelope", async () => {
    const response = await controllerFor(fakeShop({ siteType: "store" })).submit(validInput());
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("validation answers 422 and an unknown lead 404", async () => {
    const c = controllerFor();
    const bad = await c.submit(validInput({ phone: "1" }));
    expect(bad.status).toBe(422);
    expect(bad.body).toMatchObject({ code: "VALIDATION" });
    const missing = await c.get({ tenantId: "t-1", leadId: "nope" });
    expect(missing.status).toBe(404);
  });

  it("list, get, changeStatus and exportRows answer 200", async () => {
    const c = controllerFor();
    const submitted = (await c.submit(validInput())).body as { leadId: string };
    const list = await c.list({ tenantId: "t-1" });
    expect(list.status).toBe(200);
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);
    const got = await c.get({ tenantId: "t-1", leadId: submitted.leadId });
    expect(got.status).toBe(200);
    const changed = await c.changeStatus({
      tenantId: "t-1",
      leadId: submitted.leadId,
      status: "contacted",
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ status: "contacted" });
    const exported = await c.exportRows({ tenantId: "t-1" });
    expect(exported.status).toBe(200);
  });

  it("maps unknown error codes to 422 and CONCURRENCY to 409", async () => {
    const { present } = await import("./presenter");
    const { ConcurrencyError, UnexpectedError } = await import("@platform/utils");
    const { err } = await import("@platform/types");
    expect(present(err(new ConcurrencyError()), 200).status).toBe(409);
    expect(present(err(new UnexpectedError()), 200).status).toBe(422);
  });
});
