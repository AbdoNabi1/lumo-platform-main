import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  Authenticator,
  AuthenticatedIdentity,
  Cache,
  Clock,
  IdGenerator,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { RoleTableAccessControl } from "@platform/auth";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { ObjectStoragePort } from "@platform/media";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";

/**
 * GET /media/assets over the real HTTP stack with the real role table: staff-readable library listing
 * (status/search/sort filters, cursor paging), the asset DTO metadata it returns, and strict tenant
 * scoping of every page. The storage here is a recording fake with fake values only.
 */

const admin: AuthenticatedIdentity = { id: "staff-a", kind: "staff", roles: ["admin"] };
const viewer: AuthenticatedIdentity = { id: "staff-v", kind: "staff", roles: ["viewer"] };
const clock: Clock = { now: () => new Date("2026-10-14T00:00:00.000Z") };
const BASE = "https://cdn.example.test/media";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3,
  0, 0, 0, 2, 8, 6, 0, 0, 0,
]);

interface Stored {
  readonly key: string;
  readonly contentType: string;
  readonly cacheControl: string;
}

function recordingStorage(stored: Stored[]): ObjectStoragePort {
  return {
    persistent: true,
    exists: async () => true,
    getDownloadUrl: async (key) => `https://signed.example/${key}`,
    put: async (key, _bytes, contentType, cacheControl) => {
      stored.push({ key, contentType, cacheControl });
    },
  };
}

function buildApp(options: {
  objectStorage?: ObjectStoragePort;
  publicMediaBaseUrl?: string;
}): Promise<FastifyInstance> {
  const claims = new Set<string>();
  const store = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(k: string) => (store.get(k) as T | undefined) ?? null,
    set: async (k, v) => void store.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void store.delete(k),
    has: async (k) => store.has(k),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key): Promise<IdempotencyClaim | null> => {
      if (claims.has(key)) return null;
      claims.add(key);
      return { key, token: "t", release: async () => claims.delete(key) };
    },
  };
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  const authenticator: Authenticator = {
    verify: async (token) =>
      token === "admin-token" ? admin : token === "viewer-token" ? viewer : null,
  };
  const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() };
  return createAdminHttpApi({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    auditTrail: new InMemoryAuditTrail(),
    authenticator,
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
    ...(options.objectStorage === undefined ? {} : { objectStorage: options.objectStorage }),
    ...(options.publicMediaBaseUrl === undefined
      ? {}
      : { publicMediaBaseUrl: options.publicMediaBaseUrl }),
    accessControl: new RoleTableAccessControl(),
  });
}

describe("media library list", () => {
  let app: FastifyInstance;
  let ids: string[];
  const headers = (token = "viewer-token", tenant = "t-1") => ({
    authorization: `Bearer ${token}`,
    "x-tenant-id": tenant,
  });
  const get = (query = "", tenant = "t-1") =>
    app.inject({
      method: "GET",
      url: `/api/v1/media/assets${query}`,
      headers: headers("viewer-token", tenant),
    });
  async function upload(name: string, tenant = "t-1") {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/media/uploads",
      headers: {
        ...headers("admin-token", tenant),
        "content-type": "image/png",
        "x-file-name": name,
        "idempotency-key": crypto.randomUUID(),
      },
      payload: Buffer.from(PNG),
    });
    expect(response.statusCode).toBe(201);
    return (response.json() as { id: string }).id;
  }
  beforeAll(async () => {
    app = await buildApp({ objectStorage: recordingStorage([]), publicMediaBaseUrl: BASE });
    ids = [];
    for (const name of ["Beach.png", "logo.png", "beach-2.png"]) ids.push(await upload(name));
  });
  afterAll(async () => {
    await app.close();
  });
  it("(a) allows viewers to list newest and exposes metadata on list and single GET", async () => {
    const res = await get("?status=active&sort=newest");
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{
      id: string;
      contentType: string;
      byteSize: number;
      createdAt: string;
    }>;
    expect(items.map((x) => x.id)).toEqual([...ids].sort().reverse());
    for (const item of items)
      expect(item).toMatchObject({
        contentType: "image/png",
        byteSize: 29,
        createdAt: "2026-10-14T00:00:00.000Z",
      });
    const single = await app.inject({
      method: "GET",
      url: `/api/v1/media/assets/${ids[0]}`,
      headers: headers(),
    });
    expect(single.statusCode).toBe(200);
    expect(single.json()).toMatchObject({
      contentType: "image/png",
      byteSize: 29,
      createdAt: "2026-10-14T00:00:00.000Z",
    });
  });
  it("(b) searches names without case sensitivity", async () => {
    const res = await get("?search=BEACH");
    expect(res.statusCode).toBe(200);
    expect((res.json().items as Array<{ name: string }>).map((x) => x.name).sort()).toEqual(
      ["Beach.png", "beach-2.png"].sort(),
    );
  });
  it("(c) filters archived assets without changing the default", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/media/assets/${ids[1]}/archive`,
      headers: { ...headers("admin-token"), "idempotency-key": crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(200);
    const itemIds = async (q: string) =>
      ((await get(q)).json().items as Array<{ id: string }>).map((x) => x.id);
    expect(await itemIds("?status=active")).toEqual([ids[0]!, ids[2]!].sort());
    expect(await itemIds("?status=archived")).toEqual([ids[1]]);
    expect(await itemIds("")).toEqual([...ids].sort());
  });
  it("(d) paginates newest in id order", async () => {
    const res = await get("?first=1&sort=newest");
    const page = res.json() as { items: Array<{ id: string }>; pageInfo: { endCursor: string } };
    const sorted = [...ids].sort().reverse();
    expect(page.items[0]!.id).toBe(sorted[0]);
    const next = await get(
      `?first=1&sort=newest&after=${encodeURIComponent(page.pageInfo.endCursor)}`,
    );
    expect(next.json().items[0].id).toBe(sorted[1]);
  });
  it("(e) isolates tenants", async () => {
    const other = await upload("other.png", "t-2");
    const res = await get();
    expect((res.json().items as Array<{ id: string }>).map((x) => x.id)).not.toContain(other);
  });
  it("(f) rejects invalid status, empty search and invalid sort", async () => {
    for (const q of ["?status=deleted", "?search=", "?sort=size"]) {
      const res = await get(q);
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ code: "VALIDATION" });
    }
  });
});
