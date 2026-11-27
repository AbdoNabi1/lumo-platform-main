import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { RoleTableAccessControl } from "@platform/auth";
import type { Cache, IdempotencyKeyStore } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import type {
  CustomerSegmentQuery,
  SegmentMembersInput,
  SegmentMembersPage,
} from "../infrastructure/cross-context/customer-segment-query";
import { createAdminHttpApi } from "./server";

const NOW = new Date("2026-07-05T00:00:00Z");

/** Records every call and answers a fixed page (the production adapter needs a database). */
class RecordingSegmentQuery implements CustomerSegmentQuery {
  readonly calls: SegmentMembersInput[] = [];
  async members(input: SegmentMembersInput): Promise<SegmentMembersPage> {
    this.calls.push(input);
    return {
      items: [
        {
          id: "0190a000-0000-7000-8000-000000000001",
          name: "Nour Hassan",
          email: "nour@example.com",
          isGuest: false,
          ordersCount: 0,
          amountSpentMinor: 0,
          lastOrderAt: null,
          emailSubscribed: false,
          smsSubscribed: false,
        },
      ],
      pageInfo: { hasNextPage: true, endCursor: "0190a000-0000-7000-8000-000000000001" },
      total: 41,
      currency: input.currency,
    };
  }
}

async function buildApp(customerSegmentQuery?: CustomerSegmentQuery): Promise<FastifyInstance> {
  const store = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(k: string) => (store.get(k) as T | undefined) ?? null,
    set: async (k, v) => void store.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void store.delete(k),
    has: async (k) => store.has(k),
  };
  const claims = new Set<string>();
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key) => {
      if (claims.has(key)) return null;
      claims.add(key);
      return { key, token: "t", release: async () => claims.delete(key) };
    },
  };
  return createAdminHttpApi({
    serializer: new InMemoryEventSerializer(),
    idGenerator: { generate: () => crypto.randomUUID() },
    clock: { now: () => NOW },
    auditTrail: new InMemoryAuditTrail(),
    authenticator: {
      verify: async (token) =>
        token === "admin-token"
          ? { id: "staff-1", kind: "staff", roles: ["admin"] }
          : token === "operator-token"
            ? { id: "staff-3", kind: "staff", roles: ["operator"] }
            : token === "viewer-token"
              ? { id: "staff-2", kind: "staff", roles: ["viewer"] }
              : null,
    },
    accessControl: new RoleTableAccessControl(),
    rateLimiter: { consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }) },
    idempotencyKeys,
    responseCache: cache,
    ...(customerSegmentQuery === undefined ? {} : { customerSegmentQuery }),
  });
}

let app: FastifyInstance;
let bareApp: FastifyInstance;
const fake = new RecordingSegmentQuery();

const authHeaders = (tenant: string, token: string) => ({
  authorization: `Bearer ${token}`,
  "x-tenant-id": tenant,
});
function post(
  path: string,
  payload?: object,
  { tenant = "t-1", token = "admin-token", target = app, key = true } = {},
) {
  return target.inject({
    method: "POST",
    url: `/api/v1${path}`,
    headers: {
      ...authHeaders(tenant, token),
      ...(key ? { "idempotency-key": crypto.randomUUID() } : {}),
    },
    ...(payload === undefined ? {} : { payload }),
  });
}
function get(path: string, { tenant = "t-1", token = "admin-token", target = app } = {}) {
  return target.inject({
    method: "GET",
    url: `/api/v1${path}`,
    headers: authHeaders(tenant, token),
  });
}
const unique = () => `Segment ${crypto.randomUUID().slice(0, 8)}`;
const fieldsOf = (res: { json: () => { fields?: { field: string }[] } }) =>
  (res.json().fields ?? []).map((f) => f.field);
const GOOD = [{ field: "orders_count", op: "gte", value: 2 }];

async function createSegment(
  name = unique(),
  conditions: unknown = GOOD,
  options: { tenant?: string; token?: string } = {},
): Promise<{ id: string; name: string }> {
  const res = await post("/customer-segments", { name, conditions }, options);
  expect(res.statusCode).toBe(201);
  return { id: res.json().segmentId as string, name };
}

beforeAll(async () => {
  app = await buildApp(fake);
  bareApp = await buildApp();
});
afterAll(async () => {
  await app.close();
  await bareApp.close();
});
beforeEach(() => {
  expect.hasAssertions();
  fake.calls.length = 0;
});

describe("GET /customer-segments", () => {
  it("lists the four default segments first, in order, then the custom ones by name", async () => {
    await createSegment("Zed shoppers");
    await createSegment("Alpha shoppers");
    const res = await get("/customer-segments");
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { id: string; kind: string; name: string | null }[];
    expect(items.slice(0, 4).map((item) => item.id)).toEqual([
      "default:purchased_at_least_once",
      "default:email_subscribers",
      "default:purchased_more_than_once",
      "default:not_purchased",
    ]);
    expect(items.slice(0, 4).every((item) => item.kind === "default" && item.name === null)).toBe(
      true,
    );
    const custom = items.slice(4).filter((item) => item.kind === "custom");
    expect(custom.map((item) => item.name)).toEqual(
      [...custom.map((item) => item.name)].sort((a, b) =>
        (a ?? "").toLowerCase().localeCompare((b ?? "").toLowerCase()),
      ),
    );
    expect(custom.map((item) => item.name)).toEqual(
      expect.arrayContaining(["Alpha shoppers", "Zed shoppers"]),
    );
  });
});

describe("create, get, update, delete", () => {
  it("creates (201 {segmentId}) and the segment reads back with its conditions at version 1", async () => {
    const { id, name } = await createSegment();
    const res = await get(`/customer-segments/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id,
      kind: "custom",
      name,
      version: 1,
      conditions: GOOD,
    });
  });

  it("takes the tenant from the context: another tenant's segment id is 404 on get, members, update, delete", async () => {
    const { id } = await createSegment();
    expect((await get(`/customer-segments/${id}`, { tenant: "t-2" })).statusCode).toBe(404);
    expect((await get(`/customer-segments/${id}/members`, { tenant: "t-2" })).statusCode).toBe(404);
    expect(
      (await post(`/customer-segments/${id}`, { expectedVersion: 1, name: "x" }, { tenant: "t-2" }))
        .statusCode,
    ).toBe(404);
    expect(
      (await post(`/customer-segments/${id}/delete`, { expectedVersion: 1 }, { tenant: "t-2" }))
        .statusCode,
    ).toBe(404);
    expect(fake.calls).toEqual([]);
    expect((await get(`/customer-segments/${id}`)).statusCode).toBe(200);
  });

  it("answers 409 for a duplicate name even with different case and spacing", async () => {
    const name = unique();
    await createSegment(name);
    const res = await post("/customer-segments", {
      name: `  ${name.toUpperCase().replace(" ", "   ")} `,
      conditions: GOOD,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CONFLICT");
    expect(res.json().message).toBe("A segment with this name already exists");
  });

  it("lets two tenants use the same segment name", async () => {
    const name = unique();
    await createSegment(name);
    await createSegment(name, GOOD, { tenant: "t-2" });
  });

  it("answers 422 with field conditions.0.value for an invalid condition", async () => {
    const res = await post("/customer-segments", {
      name: unique(),
      conditions: [{ field: "orders_count", op: "gte", value: -1 }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VALIDATION");
    expect(fieldsOf(res)).toEqual(["conditions.0.value"]);
  });

  it("reports an invalid name and an invalid condition in ONE 422", async () => {
    const res = await post("/customer-segments", {
      name: "   ",
      conditions: [{ field: "orders_count", op: "gte", value: 1.5 }],
    });
    expect(res.statusCode).toBe(422);
    expect(fieldsOf(res).sort()).toEqual(["conditions.0.value", "name"]);
  });

  it("answers 422 for zero conditions (field conditions) and for an unknown key in the body", async () => {
    const none = await post("/customer-segments", { name: unique(), conditions: [] });
    expect(none.statusCode).toBe(422);
    expect(fieldsOf(none)).toEqual(["conditions"]);
    const extra = await post("/customer-segments", {
      name: unique(),
      conditions: GOOD,
      tenantId: "t-2",
    });
    expect(extra.statusCode).toBe(422);
    expect(extra.json().code).toBe("VALIDATION");
  });

  it("updates the name and conditions: 200 {segmentId, version}, then a stale version is 409", async () => {
    const { id } = await createSegment();
    const renamed = unique();
    const ok = await post(`/customer-segments/${id}`, {
      expectedVersion: 1,
      name: renamed,
      conditions: [{ field: "email_subscribed", value: true }],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ segmentId: id, version: 2 });
    expect((await get(`/customer-segments/${id}`)).json()).toMatchObject({
      name: renamed,
      version: 2,
      conditions: [{ field: "email_subscribed", value: true }],
    });
    const stale = await post(`/customer-segments/${id}`, { expectedVersion: 1, name: unique() });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().message).toBe("This segment was changed by someone else");
  });

  it("answers 422 field body when an update changes nothing, and 422 for expectedVersion 0", async () => {
    const { id } = await createSegment();
    const empty = await post(`/customer-segments/${id}`, { expectedVersion: 1 });
    expect(empty.statusCode).toBe(422);
    expect(fieldsOf(empty)).toEqual(["body"]);
    expect(
      (await post(`/customer-segments/${id}`, { expectedVersion: 0, name: "x" })).statusCode,
    ).toBe(422);
  });

  it("answers 409 when a default segment is updated or deleted", async () => {
    const update = await post("/customer-segments/default:not_purchased", {
      expectedVersion: 1,
      name: "Mine",
    });
    expect(update.statusCode).toBe(409);
    expect(update.json().message).toBe("Default segments can't be changed");
    const del = await post("/customer-segments/default:not_purchased/delete", {
      expectedVersion: 1,
    });
    expect(del.statusCode).toBe(409);
  });

  it("deletes (200) and the segment is then 404; a stale delete is 409; an unknown id is 404", async () => {
    const { id } = await createSegment();
    const stale = await post(`/customer-segments/${id}/delete`, { expectedVersion: 5 });
    expect(stale.statusCode).toBe(409);
    const ok = await post(`/customer-segments/${id}/delete`, { expectedVersion: 1 });
    expect(ok.statusCode).toBe(200);
    expect((await get(`/customer-segments/${id}`)).statusCode).toBe(404);
    expect(
      (
        await post(`/customer-segments/${crypto.randomUUID()}/delete`, {
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("answers 404 for an unknown segment and a non-UUID id", async () => {
    expect((await get(`/customer-segments/${crypto.randomUUID()}`)).statusCode).toBe(404);
    expect((await get("/customer-segments/not-a-uuid")).statusCode).toBe(404);
  });

  it("replays a POST with the same Idempotency-Key instead of creating twice", async () => {
    const name = unique();
    const key = crypto.randomUUID();
    const send = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/customer-segments",
        headers: { ...authHeaders("t-1", "admin-token"), "idempotency-key": key },
        payload: { name, conditions: GOOD },
      });
    const first = await send();
    expect(first.statusCode).toBe(201);
    const second = await send();
    // The stored response is replayed (same id), not a second create (which would be a 409 duplicate).
    expect(second.json()).toEqual(first.json());
    const listed = (await get("/customer-segments")).json().items as { name: string | null }[];
    expect(listed.filter((item) => item.name === name)).toHaveLength(1);
  });
});

describe("permissions", () => {
  it("a viewer is 403 on create, update and delete and reads list, get, members, preview, store-currency", async () => {
    const { id } = await createSegment();
    const viewer = { token: "viewer-token" };
    expect(
      (await post("/customer-segments", { name: unique(), conditions: GOOD }, viewer)).statusCode,
    ).toBe(403);
    expect(
      (await post(`/customer-segments/${id}`, { expectedVersion: 1, name: "x" }, viewer))
        .statusCode,
    ).toBe(403);
    expect(
      (await post(`/customer-segments/${id}/delete`, { expectedVersion: 1 }, viewer)).statusCode,
    ).toBe(403);
    expect((await get("/customer-segments", viewer)).statusCode).toBe(200);
    expect((await get(`/customer-segments/${id}`, viewer)).statusCode).toBe(200);
    expect((await get(`/customer-segments/${id}/members`, viewer)).statusCode).toBe(200);
    expect(
      (await post("/customer-segments/preview", { conditions: GOOD }, { ...viewer, key: false }))
        .statusCode,
    ).toBe(200);
    expect((await get("/customer-segments/store-currency", viewer)).statusCode).toBe(200);
    // The segment survived the denied writes.
    expect((await get(`/customer-segments/${id}`)).json().version).toBe(1);
  });

  it("an operator manages segments (customers:*)", async () => {
    const operator = { token: "operator-token" };
    const { id } = await createSegment(unique(), GOOD, operator);
    expect(
      (await post(`/customer-segments/${id}/delete`, { expectedVersion: 1 }, operator)).statusCode,
    ).toBe(200);
  });

  it("an anonymous caller is 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/customer-segments" });
    expect(res.statusCode).toBe(401);
  });
});

describe("store-currency", () => {
  it("answers the shop currency only, and is not swallowed by /:segmentId", async () => {
    const res = await get("/customer-segments/store-currency");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { currency: string };
    expect(Object.keys(body)).toEqual(["currency"]);
    expect(body.currency).toMatch(/^[A-Z]{3}$/);
  });
});

describe("GET /customer-segments/:segmentId/members", () => {
  it("passes the segment's conditions, the shop currency/timezone, now and the paging to the query", async () => {
    const { id } = await createSegment(unique(), GOOD);
    const cursor = "0190a000-0000-7000-8000-0000000000aa";
    const res = await get(`/customer-segments/${id}/members?first=25&after=${cursor}&search=nour`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 41, items: [{ name: "Nour Hassan" }] });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call).toMatchObject({
      tenantId: "t-1",
      conditions: GOOD,
      first: 25,
      after: cursor,
      search: "nour",
    });
    expect(call?.now).toEqual(NOW);
    expect(call?.currency).toMatch(/^[A-Z]{3}$/);
    expect(call?.timezone).not.toBe("");
    expect(res.json().currency).toBe(call?.currency);
  });

  it("defaults first to 50 and omits after/search", async () => {
    await get("/customer-segments/default:email_subscribers/members");
    expect(fake.calls[0]).toMatchObject({
      first: 50,
      conditions: [{ field: "email_subscribed", value: true }],
    });
    expect(fake.calls[0]).not.toHaveProperty("after");
    expect(fake.calls[0]).not.toHaveProperty("search");
  });

  it("rejects first outside 1..100 and a search over 100 characters with 422 before the query", async () => {
    for (const query of ["first=0", "first=101", `search=${"x".repeat(101)}`, "search="]) {
      const res = await get(`/customer-segments/default:not_purchased/members?${query}`);
      expect(res.statusCode).toBe(422);
    }
    expect(fake.calls).toEqual([]);
  });

  it("answers 404 for an unknown segment without calling the query", async () => {
    const res = await get(`/customer-segments/${crypto.randomUUID()}/members`);
    expect(res.statusCode).toBe(404);
    expect(fake.calls).toEqual([]);
  });
});

describe("POST /customer-segments/preview", () => {
  it("validates first: 422 with the condition field paths and the query is never called", async () => {
    const res = await post(
      "/customer-segments/preview",
      { conditions: [{ field: "orders_count", op: "gte", value: -3 }] },
      { key: false },
    );
    expect(res.statusCode).toBe(422);
    expect(fieldsOf(res)).toEqual(["conditions.0.value"]);
    const empty = await post("/customer-segments/preview", { conditions: [] }, { key: false });
    expect(empty.statusCode).toBe(422);
    expect(fieldsOf(empty)).toEqual(["conditions"]);
    expect(fake.calls).toEqual([]);
  });

  it("passes the parsed conditions and first (default 10) to the query, needs no idempotency key", async () => {
    const res = await post(
      "/customer-segments/preview",
      {
        conditions: [
          { field: "tags", op: "has_any", values: ["VIP", " vip ", "Cairo"] },
          { field: "country", op: "in", values: [" eg "] },
        ],
      },
      { key: false },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 41 });
    expect(fake.calls[0]).toMatchObject({
      tenantId: "t-1",
      first: 10,
      conditions: [
        { field: "tags", op: "has_any", values: ["VIP", "Cairo"] },
        { field: "country", op: "in", values: ["EG"] },
      ],
    });
    await post("/customer-segments/preview", { conditions: GOOD, first: 3 }, { key: false });
    expect(fake.calls[1]?.first).toBe(3);
  });

  it("is not idempotent: the same key twice runs the query twice", async () => {
    const key = crypto.randomUUID();
    const send = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/customer-segments/preview",
        headers: { ...authHeaders("t-1", "admin-token"), "idempotency-key": key },
        payload: { conditions: GOOD },
      });
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect(fake.calls).toHaveLength(2);
  });

  it("rejects first over 50, unknown keys and more than 50 raw conditions at the transport", async () => {
    expect(
      (await post("/customer-segments/preview", { conditions: GOOD, first: 51 }, { key: false }))
        .statusCode,
    ).toBe(422);
    expect(
      (await post("/customer-segments/preview", { conditions: GOOD, x: 1 }, { key: false }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await post(
          "/customer-segments/preview",
          { conditions: Array.from({ length: 51 }, () => GOOD[0]) },
          { key: false },
        )
      ).statusCode,
    ).toBe(422);
    expect(fake.calls).toEqual([]);
  });
});

describe("GET /customers?segmentId", () => {
  it("answers from the segment query in the list shape {items:[{id,name,email}], pageInfo}", async () => {
    const res = await get("/customers?segmentId=default:not_purchased&first=5&search=no");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        {
          id: "0190a000-0000-7000-8000-000000000001",
          name: "Nour Hassan",
          email: "nour@example.com",
        },
      ],
      pageInfo: { hasNextPage: true, endCursor: "0190a000-0000-7000-8000-000000000001" },
    });
    expect(fake.calls[0]).toMatchObject({
      tenantId: "t-1",
      first: 5,
      search: "no",
      conditions: [{ field: "orders_count", op: "eq", value: 0 }],
    });
  });

  it("uses a custom segment's conditions and page size 50 by default", async () => {
    const { id } = await createSegment(unique(), [{ field: "language", op: "unset" }]);
    await get(`/customers?segmentId=${id}`);
    expect(fake.calls[0]).toMatchObject({
      first: 50,
      conditions: [{ field: "language", op: "unset" }],
    });
  });

  it("answers 404 for an unknown segment and 401 for an anonymous caller", async () => {
    expect((await get(`/customers?segmentId=${crypto.randomUUID()}`)).statusCode).toBe(404);
    expect(fake.calls).toEqual([]);
    const anonymous = await app.inject({ method: "GET", url: "/api/v1/customers?segmentId=x" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("without segmentId the existing customer list is unchanged and never touches the query", async () => {
    const res = await get("/customers");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("items");
    expect(fake.calls).toEqual([]);
  });
});

describe("without a segment query and without Prisma", () => {
  it("members, preview and GET /customers?segmentId answer 503 UNAVAILABLE, never an empty list", async () => {
    const members = await get("/customer-segments/default:not_purchased/members", {
      target: bareApp,
    });
    expect(members.statusCode).toBe(503);
    expect(members.json()).toMatchObject({ code: "UNAVAILABLE" });
    const preview = await post(
      "/customer-segments/preview",
      { conditions: GOOD },
      { target: bareApp, key: false },
    );
    expect(preview.statusCode).toBe(503);
    expect(preview.json().code).toBe("UNAVAILABLE");
    const list = await get("/customers?segmentId=default:not_purchased", { target: bareApp });
    expect(list.statusCode).toBe(503);
    expect(list.json().code).toBe("UNAVAILABLE");
  });

  it("definitions still work (they live in Identity, not in the query)", async () => {
    const res = await get("/customer-segments", { target: bareApp });
    expect(res.statusCode).toBe(200);
    const created = await post(
      "/customer-segments",
      { name: unique(), conditions: GOOD },
      { target: bareApp },
    );
    expect(created.statusCode).toBe(201);
  });
});
