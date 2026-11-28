import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import {
  buildLeadsApp,
  headersFor,
  leadBody,
  submitLead,
  type StaffRole,
} from "./testing/leads-harness";

beforeEach(() => {
  expect.hasAssertions();
});

interface LeadJson {
  id: string;
  name: string;
  status: string;
  trackingStatus: string;
  phoneE164: string;
  eventId: string;
}
interface PageJson {
  items: LeadJson[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

let app: FastifyInstance;
let seq = 0;
const idem = () => ({ "idempotency-key": `status-key-${String((seq += 1)).padStart(6, "0")}` });

function call(
  role: StaffRole,
  method: "GET" | "POST",
  url: string,
  options: { payload?: unknown; tenantId?: string } = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: headersFor(role, {
      "x-tenant-id": options.tenantId ?? "t-1",
      ...(method === "POST" ? idem() : {}),
    }),
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
  });
}

async function seed(name: string, tenantId = "t-1"): Promise<string> {
  const res = await submitLead(
    app,
    leadBody({ name, sessionId: `session-${String((seq += 1))}` }),
    {
      tenantId,
    },
  );
  expect(res.statusCode).toBe(201);
  return (res.json() as { leadId: string }).leadId;
}

let aliceId: string;
let bobId: string;
let shopBLeadId: string;

beforeAll(async () => {
  ({ app } = await buildLeadsApp());
  aliceId = await seed("Alice Hassan");
  bobId = await seed("Bob Mostafa");
  shopBLeadId = await seed("Zed Of Shop B", "t-2");
});
afterAll(async () => {
  await app.close();
});

describe("leads inbox — an operator works the inbox", () => {
  it("lists the shop's leads (explicit DTO, no aggregate internals)", async () => {
    const res = await call("operator", "GET", "/leads");
    expect(res.statusCode).toBe(200);
    const page = res.json() as PageJson;
    expect(page.items.map((l) => l.name).sort()).toEqual(["Alice Hassan", "Bob Mostafa"]);
    expect(page.items[0]).not.toHaveProperty("props");
    expect(page.items[0]).not.toHaveProperty("sessionId");
    expect(page.items[0]).not.toHaveProperty("submissionKey");
    expect(page.items[0]).toMatchObject({ status: "new", phoneE164: "+201012345678" });
  });

  it("filters by status, searches by name and caps `first` at 100", async () => {
    expect(
      ((await call("operator", "GET", "/leads?status=contacted")).json() as PageJson).items,
    ).toEqual([]);
    const found = (await call("operator", "GET", "/leads?search=bob")).json() as PageJson;
    expect(found.items.map((l) => l.id)).toEqual([bobId]);
    expect((await call("operator", "GET", "/leads?first=101")).statusCode).toBe(422);
    expect((await call("operator", "GET", "/leads?status=nonsense")).statusCode).toBe(422);
  });

  it("pages with a cursor", async () => {
    const first = (await call("operator", "GET", "/leads?first=1")).json() as PageJson;
    expect(first.items).toHaveLength(1);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const next = (
      await call("operator", "GET", `/leads?first=1&after=${first.pageInfo.endCursor ?? ""}`)
    ).json() as PageJson;
    expect(next.items).toHaveLength(1);
    expect(next.items[0]!.id).not.toBe(first.items[0]!.id);
  });

  it("reads one lead", async () => {
    const res = await call("operator", "GET", `/leads/${aliceId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: aliceId, name: "Alice Hassan", status: "new" });
  });

  it("changes the status; the same status again is a no-op success; an unknown status is 422", async () => {
    const moved = await call("operator", "POST", `/leads/${bobId}/status`, {
      payload: { status: "contacted" },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ id: bobId, status: "contacted" });
    const again = await call("operator", "POST", `/leads/${bobId}/status`, {
      payload: { status: "contacted" },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ status: "contacted" });
    const read = await call("operator", "GET", `/leads/${bobId}`);
    expect(read.json()).toMatchObject({ status: "contacted" });
    const bad = await call("operator", "POST", `/leads/${bobId}/status`, {
      payload: { status: "nonsense" },
    });
    expect(bad.statusCode).toBe(422);
    const extra = await call("operator", "POST", `/leads/${bobId}/status`, {
      payload: { status: "qualified", tenantId: "t-2" },
    });
    expect(extra.statusCode).toBe(422);
    // restore for the other tests
    await call("operator", "POST", `/leads/${bobId}/status`, { payload: { status: "new" } });
  });

  it("exports rows (cursor pages) with the status and date filters", async () => {
    const all = await call("operator", "GET", "/leads/export-rows");
    expect(all.statusCode).toBe(200);
    expect((all.json() as PageJson).items.map((l) => l.name).sort()).toEqual([
      "Alice Hassan",
      "Bob Mostafa",
    ]);
    const none = await call("operator", "GET", "/leads/export-rows?status=converted");
    expect((none.json() as PageJson).items).toEqual([]);
    const future = await call("operator", "GET", "/leads/export-rows?createdFrom=2030-01-01");
    expect((future.json() as PageJson).items).toEqual([]);
    const within = await call(
      "operator",
      "GET",
      "/leads/export-rows?createdFrom=2026-11-23T00:00:00Z&createdTo=2026-11-24T00:00:00Z",
    );
    expect((within.json() as PageJson).items).toHaveLength(2);
    expect(
      (await call("operator", "GET", "/leads/export-rows?createdFrom=notadate")).statusCode,
    ).toBe(422);
  });
});

describe("leads inbox — roles", () => {
  it("a viewer lists and reads, and is refused (403) the status change and the export", async () => {
    expect((await call("viewer", "GET", "/leads")).statusCode).toBe(200);
    expect((await call("viewer", "GET", `/leads/${aliceId}`)).statusCode).toBe(200);
    const status = await call("viewer", "POST", `/leads/${aliceId}/status`, {
      payload: { status: "contacted" },
    });
    expect(status.statusCode).toBe(403);
    expect((await call("viewer", "GET", "/leads/export-rows")).statusCode).toBe(403);
    expect(((await call("operator", "GET", `/leads/${aliceId}`)).json() as LeadJson).status).toBe(
      "new",
    );
  });

  it("an admin does everything an operator does", async () => {
    expect((await call("admin", "GET", "/leads")).statusCode).toBe(200);
    expect((await call("admin", "GET", "/leads/export-rows")).statusCode).toBe(200);
  });

  it("an unknown token is 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: { authorization: "Bearer nobody", "x-tenant-id": "t-1" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("leads inbox — shop A never sees shop B's leads", () => {
  it("lists and exports only the caller's shop", async () => {
    const a = (await call("operator", "GET", "/leads")).json() as PageJson;
    const b = (await call("operator", "GET", "/leads", { tenantId: "t-2" })).json() as PageJson;
    expect(a.items.map((l) => l.id)).not.toContain(shopBLeadId);
    expect(b.items.map((l) => l.id)).toEqual([shopBLeadId]);
    const exported = (await call("operator", "GET", "/leads/export-rows")).json() as PageJson;
    expect(exported.items.map((l) => l.id)).not.toContain(shopBLeadId);
    const search = (await call("operator", "GET", "/leads?search=Zed")).json() as PageJson;
    expect(search.items).toEqual([]);
  });

  it("get → 404 and status → 404 for another shop's lead, and the lead is untouched", async () => {
    const get = await call("operator", "GET", `/leads/${shopBLeadId}`);
    expect(get.statusCode).toBe(404);
    const status = await call("operator", "POST", `/leads/${shopBLeadId}/status`, {
      payload: { status: "rejected" },
    });
    expect(status.statusCode).toBe(404);
    const own = await call("operator", "GET", `/leads/${shopBLeadId}`, { tenantId: "t-2" });
    expect(own.json()).toMatchObject({ id: shopBLeadId, status: "new" });
  });
});
