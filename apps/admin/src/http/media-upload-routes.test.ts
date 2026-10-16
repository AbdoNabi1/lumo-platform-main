import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AccessControl,
  Authenticator,
  AuthenticatedIdentity,
  Cache,
  Clock,
  IdGenerator,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { ObjectStoragePort } from "@platform/media";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";

/**
 * Plan 2C-3 — product image uploads over the real HTTP stack: staff only (`products:update`), 8 MB at
 * most, magic-byte checked, never SVG, tenant-prefixed keys, and an honest 503 when storage is not set
 * up. The storage here is a recording fake with fake values only.
 */

const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock: Clock = { now: () => new Date("2026-10-14T00:00:00.000Z") };
const BASE = "https://cdn.example.test/media";
const EIGHT_MB = 8 * 1024 * 1024;

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3,
  0, 0, 0, 2, 8, 6, 0, 0, 0,
]);

function authed(contentType: string, tenant = "t-1") {
  return { authorization: "Bearer good", "x-tenant-id": tenant, "content-type": contentType };
}

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
  accessControl?: AccessControl;
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
    verify: async (token) => (token === "good" ? staff : null),
  };
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `${crypto.randomUUID()}-${(n += 1)}` };
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
    ...(options.accessControl === undefined ? {} : { accessControl: options.accessControl }),
  });
}

describe("POST /media/uploads", () => {
  const stored: Stored[] = [];
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ objectStorage: recordingStorage(stored), publicMediaBaseUrl: BASE });
  });
  afterAll(async () => {
    await app.close();
  });

  const upload = (payload: Uint8Array | Buffer, contentType = "image/png", tenant = "t-1") =>
    app.inject({
      method: "POST",
      url: "/api/v1/media/uploads",
      headers: { ...authed(contentType, tenant), "x-file-name": encodeURIComponent("صورة.png") },
      payload: Buffer.from(payload),
    });

  it("stores a png under the tenant's prefix and returns the public url, size and no storage key", async () => {
    stored.length = 0;
    const res = await upload(PNG);

    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ width: 3, height: 2, alt: null });
    expect(Object.keys(body).sort()).toEqual(["alt", "height", "id", "url", "width"]);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.key).toMatch(/^tenants\/t-1\/product-images\/2026\/10\/.+\.png$/);
    expect(stored[0]!.contentType).toBe("image/png");
    expect(stored[0]!.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(body["url"]).toBe(`${BASE}/${stored[0]!.key}`);
  });

  it("is 413 over 8 MB, and writes nothing", async () => {
    stored.length = 0;
    const res = await upload(Buffer.alloc(EIGHT_MB + 1));
    expect(res.statusCode).toBe(413);
    expect(stored).toHaveLength(0);
  });

  it("is 415 for an svg, by declared type", async () => {
    stored.length = 0;
    const res = await upload(
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      "image/svg+xml",
    );
    expect(res.statusCode).toBe(415);
    expect(stored).toHaveLength(0);
  });

  it("is 415 for an svg or text dressed up as image/png (the bytes decide, not the header)", async () => {
    stored.length = 0;
    const svg = await upload(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"));
    const text = await upload(Buffer.from("hello, not an image"));
    expect(svg.statusCode).toBe(415);
    expect(text.statusCode).toBe(415);
    expect(stored).toHaveLength(0);
  });

  it("is 401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/media/uploads",
      headers: { "x-tenant-id": "t-1", "content-type": "image/png" },
      payload: Buffer.from(PNG),
    });
    expect(res.statusCode).toBe(401);
  });

  it("is 503 with a plain message when storage is not set up", async () => {
    const unconfigured = await buildApp({});
    try {
      const res = await unconfigured.inject({
        method: "POST",
        url: "/api/v1/media/uploads",
        headers: authed("image/png"),
        payload: Buffer.from(PNG),
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ message: "Image storage isn't set up yet." });
    } finally {
      await unconfigured.close();
    }
  });

  it("requires products:update (403 without it), and writes nothing", async () => {
    const forbidden: Stored[] = [];
    const denied = await buildApp({
      objectStorage: recordingStorage(forbidden),
      publicMediaBaseUrl: BASE,
      accessControl: { authorize: async (_p, permission) => permission !== "products:update" },
    });
    try {
      const res = await denied.inject({
        method: "POST",
        url: "/api/v1/media/uploads",
        headers: authed("image/png"),
        payload: Buffer.from(PNG),
      });
      expect(res.statusCode).toBe(403);
      expect(forbidden).toHaveLength(0);
    } finally {
      await denied.close();
    }
  });
});

describe("PATCH /media/assets/:id (alt text)", () => {
  const stored: Stored[] = [];
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ objectStorage: recordingStorage(stored), publicMediaBaseUrl: BASE });
  });
  afterAll(async () => {
    await app.close();
  });

  async function uploadOne(): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/media/uploads",
      headers: authed("image/png"),
      payload: Buffer.from(PNG),
    });
    return (res.json() as { id: string }).id;
  }
  const patch = (id: string, alt: string | null, tenant = "t-1") =>
    app.inject({
      method: "PATCH",
      url: `/api/v1/media/assets/${id}`,
      headers: authed("application/json", tenant),
      payload: { alt },
    });

  it("sets and clears the alt text", async () => {
    const id = await uploadOne();
    const set = await patch(id, "Red shoe");
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ mediaAssetId: id, alt: "Red shoe" });
    const cleared = await patch(id, null);
    expect(cleared.json()).toEqual({ mediaAssetId: id, alt: null });
  });

  it("is 422 over 512 characters", async () => {
    const id = await uploadOne();
    expect((await patch(id, "a".repeat(513))).statusCode).toBe(422);
  });

  it("is 404 for another tenant's asset", async () => {
    const id = await uploadOne();
    expect((await patch(id, "stolen", "t-2")).statusCode).toBe(404);
  });
});
