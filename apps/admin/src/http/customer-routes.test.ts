import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { RoleTableAccessControl } from "@platform/auth";
import type { Cache, IdempotencyKeyStore, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { Customer } from "@platform/identity";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import type { WiredAdmin } from "../composition";
import { annotationsOfCustomer, toCustomerExportRowDto } from "./customer-routes";
import { createAdminHttpApi } from "./server";

let app: FastifyInstance;
const headers = (tenant = "t-1", token = "admin-token") => ({
  authorization: `Bearer ${token}`,
  "x-tenant-id": tenant,
});
async function post(path: string, payload?: object, tenant = "t-1", token = "admin-token") {
  return app.inject({
    method: "POST",
    url: `/api/v1${path}`,
    headers: { ...headers(tenant, token), "idempotency-key": crypto.randomUUID() },
    ...(payload === undefined ? {} : { payload }),
  });
}
async function get(path: string, tenant = "t-1", token = "admin-token") {
  return app.inject({ method: "GET", url: `/api/v1${path}`, headers: headers(tenant, token) });
}
const unique = () => crypto.randomUUID();
const emailOf = (tag: string = unique()) => `${tag}@example.com`;
/** A customer in `tenant`; returns its id. */
async function customer(body: object = {}, tenant = "t-1", token = "admin-token") {
  const res = await post(
    "/customers",
    { name: "Nour Hassan", email: emailOf(), ...body },
    tenant,
    token,
  );
  expect(res.statusCode).toBe(201);
  return res.json().customerId as string;
}
async function detail(id: string, tenant = "t-1", token = "admin-token") {
  const res = await get(`/customers/${id}`, tenant, token);
  expect(res.statusCode).toBe(200);
  return res.json();
}
const fieldsOf = (res: { json: () => { fields?: { field: string }[] } }) =>
  (res.json().fields ?? []).map((f) => f.field);
const hundredTagsInOneString = Array.from(
  { length: 100 },
  (_, i) => `tag${String(i).padStart(3, "0")}`,
).join(", ");
const hundredTagsSorted = Array.from({ length: 100 }, (_, i) => `tag${String(i).padStart(3, "0")}`);
const codePoints = (n: number, ch = "é") => ch.repeat(n);

beforeAll(async () => {
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
  app = await createAdminHttpApi({
    serializer: new InMemoryEventSerializer(),
    idGenerator: { generate: () => crypto.randomUUID() },
    clock: { now: () => new Date("2026-07-05T00:00:00Z") },
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
  });
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  expect.hasAssertions();
});

describe("POST /customers", () => {
  it("creates a customer (201 {customerId}) and the detail shows every field", async () => {
    const email = emailOf();
    const res = await post("/customers", {
      name: "  Nour Hassan  ",
      email,
      phone: "010 1234-5678",
      language: "ar",
      note: "  prefers evening calls  ",
      tags: ["VIP", " vip ", "Cairo"],
      marketingEmail: true,
    });
    expect(res.statusCode).toBe(201);
    expect(Object.keys(res.json())).toEqual(["customerId"]);
    const body = await detail(res.json().customerId);
    expect(body).toMatchObject({
      id: res.json().customerId,
      name: "Nour Hassan",
      email,
      phone: "01012345678",
      language: "ar",
      isGuest: false,
      note: "prefers evening calls",
      tags: ["Cairo", "VIP"],
      marketing: { email: true, sms: false },
      addresses: [],
    });
    expect(body.consents).toEqual([expect.objectContaining({ scope: "marketing", granted: true })]);
  });
  it("creates a minimal customer: no phone, language, note or tags; both channels off", async () => {
    const body = await detail(await customer());
    expect(body).toMatchObject({
      phone: null,
      language: null,
      note: null,
      tags: [],
      isGuest: false,
      marketing: { email: false, sms: false },
    });
  });
  it("records SMS marketing under its own scope", async () => {
    const body = await detail(await customer({ marketingSms: true }));
    expect(body.marketing).toEqual({ email: false, sms: true });
    expect(body.consents).toEqual([
      expect.objectContaining({ scope: "marketing_sms", granted: true }),
    ]);
  });
  it("answers 409 CONFLICT for a duplicate email", async () => {
    const email = emailOf();
    await customer({ email });
    const res = await post("/customers", { name: "Other", email });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CONFLICT");
  });
  it("lets the same email exist in another tenant", async () => {
    const email = emailOf();
    await customer({ email });
    await customer({ email }, "t-2");
  });
  it("answers 422 with field phone for an invalid phone", async () => {
    const res = await post("/customers", { name: "A", email: emailOf(), phone: "12345" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VALIDATION");
    expect(fieldsOf(res)).toEqual(["phone"]);
  });
  it("reports every failing field in one 422 (name, email, phone, language-free)", async () => {
    const res = await post("/customers", { name: "   ", email: "nope", phone: "abc1234567" });
    expect(res.statusCode).toBe(422);
    expect(fieldsOf(res).sort()).toEqual(["email", "name", "phone"]);
  });
  it("answers 422 for an unknown key in the body", async () => {
    const res = await post("/customers", { name: "A", email: emailOf(), tenantId: "t-2" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VALIDATION");
  });
  it("answers 422 for a language outside en/ar", async () => {
    const res = await post("/customers", { name: "A", email: emailOf(), language: "fr" });
    expect(res.statusCode).toBe(422);
  });
  it("takes the tenant from the context, never the body", async () => {
    const id = await customer({}, "t-2");
    expect((await get(`/customers/${id}`, "t-1")).statusCode).toBe(404);
    expect((await get(`/customers/${id}`, "t-2")).statusCode).toBe(200);
  });
  it("answers 422 field name for a 256-code-point name; 255 is accepted", async () => {
    const res = await post("/customers", { name: codePoints(256), email: emailOf() });
    expect(res.statusCode).toBe(422);
    expect(fieldsOf(res)).toEqual(["name"]);
    expect((await post("/customers", { name: codePoints(255), email: emailOf() })).statusCode).toBe(
      201,
    );
  });
  it("answers 422 field note for 5001 code points; exactly 5000 emoji is accepted", async () => {
    const res = await post("/customers", { name: "A", email: emailOf(), note: codePoints(5001) });
    expect(res.statusCode).toBe(422);
    expect(fieldsOf(res)).toEqual(["note"]);
    const ok = await post("/customers", { name: "A", email: emailOf(), note: "😀".repeat(5000) });
    expect(ok.statusCode).toBe(201);
  });
  it("accepts a 40-emoji tag", async () => {
    const tag = "😀".repeat(40);
    const body = await detail(await customer({ tags: [tag] }));
    expect(body.tags).toEqual([tag]);
  });
  it("answers 422 field tags for a 41-code-point tag", async () => {
    const res = await post("/customers", { name: "A", email: emailOf(), tags: ["😀".repeat(41)] });
    expect(res.statusCode).toBe(422);
    expect(fieldsOf(res)).toEqual(["tags"]);
  });
  it('splits Latin and Arabic commas: ["a, b، c"] → three tags', async () => {
    const body = await detail(await customer({ tags: ["a, b، c"] }));
    expect(body.tags).toEqual(["a", "b", "c"]);
  });
  it("accepts 100 tags in ONE raw string and stores those 100, sorted", async () => {
    expect(hundredTagsInOneString.length).toBe(798);
    const body = await detail(await customer({ tags: [hundredTagsInOneString] }));
    expect(body.tags).toEqual(hundredTagsSorted);
  });
  it("answers 422 field tags for 251 distinct tags; 250 are accepted", async () => {
    const distinct = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    const res = await post("/customers", { name: "A", email: emailOf(), tags: distinct(251) });
    expect(res.statusCode).toBe(422);
    expect(fieldsOf(res)).toEqual(["tags"]);
    const ok = await post("/customers", { name: "A", email: emailOf(), tags: distinct(250) });
    expect(ok.statusCode).toBe(201);
  });
  it("counts the 250 limit after de-duplication, not on the raw array", async () => {
    const tags = Array.from({ length: 300 }, (_, i) => `t${i % 10}`);
    expect((await post("/customers", { name: "A", email: emailOf(), tags })).statusCode).toBe(201);
  });
  it("replays one Idempotency-Key: same answer, one customer", async () => {
    const key = crypto.randomUUID();
    const token = unique();
    const payload = { name: "Once", email: emailOf(token) };
    const send = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/customers",
        headers: { ...headers(), "idempotency-key": key },
        payload,
      });
    const first = await send();
    expect(first.statusCode).toBe(201);
    const replay = await send();
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const listed = await get(`/customers?search=${token}`);
    expect(listed.json().items).toHaveLength(1);
  });
});

describe("POST /customers/:customerId (profile)", () => {
  it("changes name, phone and language; phone null and language null clear", async () => {
    const id = await customer({ phone: "01012345678", language: "en" });
    const res = await post(`/customers/${id}`, {
      name: " Nour H. ",
      phone: "+20 (10) 9999 0000",
      language: "ar",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ customerId: id });
    expect(await detail(id)).toMatchObject({
      name: "Nour H.",
      phone: "+201099990000",
      language: "ar",
    });
    expect((await post(`/customers/${id}`, { phone: null, language: null })).statusCode).toBe(200);
    expect(await detail(id)).toMatchObject({ name: "Nour H.", phone: null, language: null });
  });
  it("keeps what is omitted and clears a phone sent as an empty string", async () => {
    const id = await customer({ phone: "01012345678", language: "en" });
    expect((await post(`/customers/${id}`, { name: "Only Name" })).statusCode).toBe(200);
    expect(await detail(id)).toMatchObject({
      name: "Only Name",
      phone: "01012345678",
      language: "en",
    });
    expect((await post(`/customers/${id}`, { phone: "" })).statusCode).toBe(200);
    expect((await detail(id)).phone).toBeNull();
  });
  it("answers 422 field body for {}", async () => {
    const id = await customer();
    const res = await post(`/customers/${id}`, {});
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VALIDATION");
    expect(fieldsOf(res)).toEqual(["body"]);
  });
  it("answers 422 for an unknown key (email is read-only)", async () => {
    const id = await customer();
    const res = await post(`/customers/${id}`, { email: emailOf() });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VALIDATION");
  });
  it("answers 422 field name for a 256-code-point name, field phone for a bad phone", async () => {
    const id = await customer();
    const longName = await post(`/customers/${id}`, { name: codePoints(256) });
    expect(longName.statusCode).toBe(422);
    expect(fieldsOf(longName)).toEqual(["name"]);
    const badPhone = await post(`/customers/${id}`, { phone: "12" });
    expect(badPhone.statusCode).toBe(422);
    expect(fieldsOf(badPhone)).toEqual(["phone"]);
    expect((await post(`/customers/${id}`, { name: null })).statusCode).toBe(422);
  });
  it("answers 404 for an unknown id", async () => {
    const res = await post(`/customers/${crypto.randomUUID()}`, { name: "X" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});

describe("POST /customers/:customerId/note", () => {
  it("sets, trims and clears the note with null", async () => {
    const id = await customer();
    const set = await post(`/customers/${id}/note`, { note: "  hi  " });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ customerId: id, note: "hi" });
    expect((await detail(id)).note).toBe("hi");
    const cleared = await post(`/customers/${id}/note`, { note: null });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({ customerId: id, note: null });
    expect((await detail(id)).note).toBeNull();
    const blank = await post(`/customers/${id}/note`, { note: "   " });
    expect(blank.json().note).toBeNull();
  });
  it("answers 422 field note for 5001 code points and 422 for a missing key or unknown key", async () => {
    const id = await customer();
    const tooLong = await post(`/customers/${id}/note`, { note: codePoints(5001) });
    expect(tooLong.statusCode).toBe(422);
    expect(fieldsOf(tooLong)).toEqual(["note"]);
    expect((await post(`/customers/${id}/note`, {})).statusCode).toBe(422);
    expect((await post(`/customers/${id}/note`, { note: "x", extra: 1 })).statusCode).toBe(422);
  });
  it("does not change the profile", async () => {
    const id = await customer({ phone: "01012345678" });
    await post(`/customers/${id}/note`, { note: "n" });
    expect(await detail(id)).toMatchObject({ name: "Nour Hassan", phone: "01012345678" });
  });
});

describe("POST /customers/:customerId/tags", () => {
  it("replaces the whole set, sorted and de-duplicated by key", async () => {
    const id = await customer({ tags: ["old", "gone"] });
    const res = await post(`/customers/${id}/tags`, { tags: ["VIP", " vip ", "Cairo"] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ customerId: id, tags: ["Cairo", "VIP"] });
    expect((await detail(id)).tags).toEqual(["Cairo", "VIP"]);
    const cleared = await post(`/customers/${id}/tags`, { tags: [] });
    expect(cleared.json()).toEqual({ customerId: id, tags: [] });
  });
  it("trims padding and accepts a 40-emoji tag", async () => {
    const id = await customer();
    const tag = "😀".repeat(40);
    const res = await post(`/customers/${id}/tags`, { tags: ["  VIP  ", tag] });
    expect(res.statusCode).toBe(200);
    expect(res.json().tags).toHaveLength(2);
    expect(res.json().tags).toContain("VIP");
    expect(res.json().tags).toContain(tag);
  });
  it('splits Latin and Arabic commas: ["a, b، c"] → three tags', async () => {
    const id = await customer();
    const res = await post(`/customers/${id}/tags`, { tags: ["a, b، c"] });
    expect(res.json().tags).toEqual(["a", "b", "c"]);
  });
  it("accepts 100 tags in ONE raw string and stores those 100, sorted", async () => {
    const id = await customer();
    const res = await post(`/customers/${id}/tags`, { tags: [hundredTagsInOneString] });
    expect(res.statusCode).toBe(200);
    expect(res.json().tags).toEqual(hundredTagsSorted);
    expect((await detail(id)).tags).toEqual(hundredTagsSorted);
  });
  it("answers 422 field tags for 251 distinct tags and keeps the previous set", async () => {
    const id = await customer({ tags: ["keep"] });
    const tags = Array.from({ length: 251 }, (_, i) => `t${i}`);
    const res = await post(`/customers/${id}/tags`, { tags });
    expect(res.statusCode).toBe(422);
    expect(fieldsOf(res)).toEqual(["tags"]);
    expect((await detail(id)).tags).toEqual(["keep"]);
    const ok = await post(`/customers/${id}/tags`, { tags: tags.slice(0, 250) });
    expect(ok.statusCode).toBe(200);
  });
  it("answers 422 field tags for a 41-code-point tag, and 422 for a missing or unknown key", async () => {
    const id = await customer();
    const res = await post(`/customers/${id}/tags`, { tags: ["x".repeat(41)] });
    expect(res.statusCode).toBe(422);
    expect(fieldsOf(res)).toEqual(["tags"]);
    expect((await post(`/customers/${id}/tags`, {})).statusCode).toBe(422);
    expect((await post(`/customers/${id}/tags`, { tags: [], add: ["a"] })).statusCode).toBe(422);
  });
});

describe("POST /customers/:customerId/marketing-consent", () => {
  it("{sms:true} → {email:false, sms:true}; the detail agrees", async () => {
    const id = await customer();
    const res = await post(`/customers/${id}/marketing-consent`, { sms: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ customerId: id, email: false, sms: true });
    expect((await detail(id)).marketing).toEqual({ email: false, sms: true });
  });
  it("changes one channel without touching the other; an unchanged value appends nothing", async () => {
    const id = await customer({ marketingEmail: true });
    await post(`/customers/${id}/marketing-consent`, { email: true });
    await post(`/customers/${id}/marketing-consent`, { sms: true });
    const off = await post(`/customers/${id}/marketing-consent`, { email: false });
    expect(off.json()).toEqual({ customerId: id, email: false, sms: true });
    const body = await detail(id);
    expect(body.marketing).toEqual({ email: false, sms: true });
    expect(
      body.consents.map((c: { scope: string; granted: boolean }) => [c.scope, c.granted]),
    ).toEqual([
      ["marketing", true],
      ["marketing_sms", true],
      ["marketing", false],
    ]);
  });
  it("answers 422 field body for {} and 422 for an unknown key or non-boolean", async () => {
    const id = await customer();
    const empty = await post(`/customers/${id}/marketing-consent`, {});
    expect(empty.statusCode).toBe(422);
    expect(fieldsOf(empty)).toEqual(["body"]);
    expect((await post(`/customers/${id}/marketing-consent`, { push: true })).statusCode).toBe(422);
    expect((await post(`/customers/${id}/marketing-consent`, { sms: "yes" })).statusCode).toBe(422);
  });
});

describe("customer detail", () => {
  it("answers 404 for an absent id", async () => {
    const res = await get(`/customers/${crypto.randomUUID()}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
  it("keeps the existing fields and lets a viewer read it", async () => {
    const id = await customer({ marketingEmail: true });
    const body = await detail(id, "t-1", "viewer-token");
    expect(Object.keys(body).sort()).toEqual(
      [
        "addresses",
        "consents",
        "email",
        "id",
        "isGuest",
        "language",
        "marketing",
        "name",
        "note",
        "phone",
        "tags",
      ].sort(),
    );
  });
  it("still lists the new customer on GET /customers (list DTO unchanged)", async () => {
    const token = unique();
    const id = await customer({ email: emailOf(token) });
    const res = await get(`/customers?search=${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([{ id, name: "Nour Hassan", email: emailOf(token) }]);
  });
});

describe("permissions", () => {
  const writes = (id: string): [string, object][] => [
    ["/customers", { name: "V", email: emailOf() }],
    [`/customers/${id}`, { name: "V" }],
    [`/customers/${id}/note`, { note: "v" }],
    [`/customers/${id}/tags`, { tags: ["v"] }],
    [`/customers/${id}/marketing-consent`, { sms: true }],
  ];
  it("answers 403 for a viewer on every write route and changes nothing", async () => {
    const id = await customer();
    for (const [path, payload] of writes(id)) {
      const res = await post(path, payload, "t-1", "viewer-token");
      expect(res.statusCode, path).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
    }
    expect(await detail(id)).toMatchObject({ name: "Nour Hassan", note: null, tags: [] });
    expect((await detail(id)).marketing).toEqual({ email: false, sms: false });
  });
  it("answers 403 for a viewer on export-rows (no customers:export)", async () => {
    const res = await get("/customers/export-rows", "t-1", "viewer-token");
    expect(res.statusCode).toBe(403);
  });
  it("lets an operator write on every route and export", async () => {
    const id = await customer({}, "t-1", "operator-token");
    const checks: [string, object, number][] = [
      [`/customers/${id}`, { name: "Op" }, 200],
      [`/customers/${id}/note`, { note: "op" }, 200],
      [`/customers/${id}/tags`, { tags: ["op"] }, 200],
      [`/customers/${id}/marketing-consent`, { email: true }, 200],
    ];
    for (const [path, payload, status] of checks) {
      expect((await post(path, payload, "t-1", "operator-token")).statusCode, path).toBe(status);
    }
    expect((await get("/customers/export-rows", "t-1", "operator-token")).statusCode).toBe(200);
  });
  it("answers 401 for no token on a write and on export-rows", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/customers",
      headers: { "x-tenant-id": "t-1", "idempotency-key": crypto.randomUUID() },
      payload: { name: "A", email: emailOf() },
    });
    expect(res.statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/customers/export-rows",
          headers: { "x-tenant-id": "t-1" },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe("another tenant's customer id", () => {
  it("answers 404 NOT_FOUND on every :customerId route and changes nothing", async () => {
    const id = await customer({ tags: ["mine"], note: "mine" });
    const attempts: [string, object][] = [
      [`/customers/${id}`, { name: "Hijack" }],
      [`/customers/${id}/note`, { note: "hijack" }],
      [`/customers/${id}/tags`, { tags: ["hijack"] }],
      [`/customers/${id}/marketing-consent`, { sms: true }],
    ];
    for (const [path, payload] of attempts) {
      const res = await post(path, payload, "t-2");
      expect(res.statusCode, path).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
    }
    const detailRes = await get(`/customers/${id}`, "t-2");
    expect(detailRes.statusCode).toBe(404);
    expect(detailRes.json().code).toBe("NOT_FOUND");
    expect(await detail(id)).toMatchObject({
      name: "Nour Hassan",
      note: "mine",
      tags: ["mine"],
      marketing: { email: false, sms: false },
    });
  });
});

describe("GET /customers/export-rows", () => {
  /** A tenant of its own, so the page counts are exact. */
  async function seededTenant() {
    const tenant = `t-export-${unique()}`;
    const token = unique().slice(0, 8);
    const ids = [] as string[];
    for (const [i, extra] of [
      {
        name: `Amal ${token}`,
        phone: "01011112222",
        language: "ar",
        tags: ["VIP", "Cairo"],
        note: "first",
        marketingEmail: true,
      },
      { name: `Basma ${token}`, marketingSms: true },
      { name: `Chris ${token}`, language: "en", note: "third" },
    ].entries()) {
      ids.push(await customer({ ...extra, email: emailOf(`${token}-${i}`) }, tenant));
    }
    return { tenant, token, ids };
  }

  it("answers rows with exactly the documented keys", async () => {
    const { tenant, ids } = await seededTenant();
    const res = await get("/customers/export-rows", tenant);
    expect(res.statusCode).toBe(200);
    const { items, pageInfo } = res.json();
    expect(items).toHaveLength(3);
    expect(pageInfo).toEqual({ hasNextPage: false, endCursor: expect.any(String) });
    for (const row of items) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "address",
          "email",
          "emailMarketing",
          "id",
          "isGuest",
          "language",
          "name",
          "note",
          "phone",
          "smsMarketing",
          "tags",
        ].sort(),
      );
    }
    const byName = new Map<string, Record<string, unknown>>(
      items.map((r: { name: string }) => [r.name.split(" ")[0] as string, r]),
    );
    expect(byName.get("Amal")).toMatchObject({
      id: ids[0],
      phone: "01011112222",
      language: "ar",
      emailMarketing: true,
      smsMarketing: false,
      tags: ["Cairo", "VIP"],
      note: "first",
      isGuest: false,
      address: null,
    });
    expect(byName.get("Basma")).toMatchObject({
      phone: null,
      language: null,
      emailMarketing: false,
      smsMarketing: true,
      tags: [],
      note: null,
    });
    expect(byName.get("Chris")).toMatchObject({ language: "en", note: "third", tags: [] });
  });
  it("pages: first=2 with an endCursor, then the rest, with no overlap", async () => {
    const { tenant, ids } = await seededTenant();
    const first = await get("/customers/export-rows?first=2", tenant);
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(2);
    expect(first.json().pageInfo.hasNextPage).toBe(true);
    const cursor = first.json().pageInfo.endCursor as string;
    expect(typeof cursor).toBe("string");
    const second = await get(
      `/customers/export-rows?first=2&after=${encodeURIComponent(cursor)}`,
      tenant,
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(1);
    expect(second.json().pageInfo.hasNextPage).toBe(false);
    const seen = [...first.json().items, ...second.json().items].map((r: { id: string }) => r.id);
    expect([...seen].sort()).toEqual([...ids].sort());
  });
  it("filters by search on name or email (case-insensitive)", async () => {
    const { tenant, token } = await seededTenant();
    const byName = await get(
      `/customers/export-rows?search=${encodeURIComponent(`basma ${token}`.toUpperCase())}`,
      tenant,
    );
    expect(byName.json().items.map((r: { name: string }) => r.name)).toEqual([`Basma ${token}`]);
    const byEmail = await get(
      `/customers/export-rows?search=${encodeURIComponent(`${token}-2@`)}`,
      tenant,
    );
    expect(byEmail.json().items.map((r: { name: string }) => r.name)).toEqual([`Chris ${token}`]);
    const none = await get("/customers/export-rows?search=zzz-no-such", tenant);
    expect(none.json().items).toEqual([]);
    expect(none.json().pageInfo.hasNextPage).toBe(false);
  });
  it("defaults the page size to 100 and rejects first outside 1..100", async () => {
    const tenant = `t-export-${unique()}`;
    for (let i = 0; i < 3; i += 1) await customer({ email: emailOf() }, tenant);
    const all = await get("/customers/export-rows", tenant);
    expect(all.json().items).toHaveLength(3);
    for (const first of ["0", "101", "abc", "-1"]) {
      const res = await get(`/customers/export-rows?first=${first}`, tenant);
      expect(res.statusCode, first).toBe(422);
    }
    expect((await get("/customers/export-rows?first=100", tenant)).statusCode).toBe(200);
  });
  it("never shows another tenant's customers", async () => {
    const { token } = await seededTenant();
    const other = await get(`/customers/export-rows?search=${token}`, `t-export-${unique()}`);
    expect(other.json().items).toEqual([]);
  });
  it("is not shadowed by /customers/:customerId", async () => {
    const res = await get("/customers/export-rows", `t-export-${unique()}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("items");
  });
});

describe("toCustomerExportRowDto", () => {
  const consent = (scope: string, granted: boolean) => ({
    scope: { value: scope },
    granted,
    occurredAt: new Date(0),
  });
  const fake = (extra: Record<string, unknown>) =>
    ({
      id: { toString: () => "c-1" },
      name: "N",
      email: { value: "n@example.com" },
      phone: null,
      language: null,
      isGuest: false,
      addresses: [],
      consents: [],
      ...extra,
    }) as unknown as Customer;

  it("takes the latest consent per scope: marketing for email, marketing_sms for SMS", () => {
    const row = toCustomerExportRowDto(
      fake({
        consents: [
          consent("marketing", true),
          consent("marketing_sms", true),
          consent("analytics", true),
          consent("marketing", false),
          consent("marketing_sms", false),
          consent("marketing_sms", true),
        ],
      }),
      null,
      [],
    );
    expect(row).toMatchObject({ emailMarketing: false, smsMarketing: true });
  });
  it("maps the FIRST address only, or null, and carries note, tags and guest marker", () => {
    const address = (line1: string) => ({
      line1,
      city: "Cairo",
      postalCode: "11511",
      country: "EG",
      extra: 1,
    });
    const row = toCustomerExportRowDto(
      fake({ addresses: [address("1 Nile St"), address("2 Other St")], isGuest: true }),
      "n",
      ["a"],
    );
    expect(row.address).toEqual({
      line1: "1 Nile St",
      city: "Cairo",
      postalCode: "11511",
      country: "EG",
    });
    expect(row).toMatchObject({ note: "n", tags: ["a"], isGuest: true });
    expect(toCustomerExportRowDto(fake({}), null, []).address).toBeNull();
  });
});

describe("annotationsOfCustomer (the detail route's note/tags read)", () => {
  const principal: Principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: "t-1" };
  const adminAnswering = (response: { status: number; body: unknown }) =>
    ({
      customers: { customerAnnotations: async () => response },
    }) as unknown as WiredAdmin;

  it("returns a failed read as that error response, never partial data", async () => {
    const failure = { status: 500, body: { code: "UNEXPECTED" } };
    const result = await annotationsOfCustomer(adminAnswering(failure), principal, "t-1", "c-1");
    expect(result).toEqual({ ok: false, response: failure });
    const denied = { status: 403, body: { code: "FORBIDDEN" } };
    expect(await annotationsOfCustomer(adminAnswering(denied), principal, "t-1", "c-1")).toEqual({
      ok: false,
      response: denied,
    });
  });
  it("returns the note and tags, and empty values when the customer has no entry", async () => {
    const found = { status: 200, body: { items: [{ customerId: "c-1", note: "n", tags: ["a"] }] } };
    expect(await annotationsOfCustomer(adminAnswering(found), principal, "t-1", "c-1")).toEqual({
      ok: true,
      note: "n",
      tags: ["a"],
    });
    const none = { status: 200, body: { items: [] } };
    expect(await annotationsOfCustomer(adminAnswering(none), principal, "t-1", "c-1")).toEqual({
      ok: true,
      note: null,
      tags: [],
    });
  });
});
