import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { MAX_BLOCKED_IPS_PER_STORE } from "@platform/tracking";
import {
  API,
  SHOP_A,
  SHOP_B,
  authed,
  buildBlockedIpsApp,
  type BlockedIpsApp,
} from "./testing/blocked-ips-harness";

/**
 * Tracking P1-D9: the excluded-IP admin API through the real multi-mode pipeline (claims tenants, the real role
 * table, the real idempotency path). Only the Redis-shaped ports and the list's store are doubles.
 */

interface Item {
  id: string;
  cidr: string;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

describe("excluded IP addresses admin routes", () => {
  let harness: BlockedIpsApp;
  let app: FastifyInstance;

  beforeEach(async () => {
    expect.hasAssertions();
    harness = await buildBlockedIpsApp();
    app = harness.app;
  });
  afterEach(async () => {
    await app.close();
  });

  const list = (token: string): Promise<LightMyRequestResponse> =>
    app.inject({ method: "GET", url: `${API}/tracking/blocked-ips`, headers: authed(token) });
  const add = (
    token: string,
    payload: unknown,
    extra: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> =>
    app.inject({
      method: "POST",
      url: `${API}/tracking/blocked-ips`,
      headers: authed(token, extra),
      payload: payload as object,
    });
  const exclude = (
    token: string,
    payload: unknown = {},
    extra: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> =>
    app.inject({
      method: "POST",
      url: `${API}/tracking/blocked-ips/exclude-this-device`,
      headers: authed(token, extra),
      payload: payload as object,
    });
  const remove = (token: string, id: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: "DELETE",
      url: `${API}/tracking/blocked-ips/${id}`,
      headers: authed(token),
    });
  const items = (res: LightMyRequestResponse): Item[] => res.json<{ items: Item[] }>().items;

  it("starts empty and states the limit", async () => {
    const res = await list("a-admin");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], limit: MAX_BLOCKED_IPS_PER_STORE });
  });

  it("adds an address (201, canonical spelling, who added it) and lists it", async () => {
    const res = await add("a-admin", { cidr: "203.0.113.7", note: "office" });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ item: Item }>().item).toMatchObject({
      cidr: "203.0.113.7/32",
      note: "office",
      createdBy: "staff-a-admin",
      createdAt: "2026-11-28T10:00:00.000Z",
    });
    expect(items(await list("a-admin")).map((item) => item.cidr)).toEqual(["203.0.113.7/32"]);
  });

  it("is idempotent: the same range again (even spelled differently) is 200 with the stored entry", async () => {
    const first = await add("a-admin", { cidr: "198.51.100.0/24" });
    const again = await add("a-admin", { cidr: "198.51.100.200/24" });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json<{ item: Item }>().item.id).toBe(first.json<{ item: Item }>().item.id);
    expect(items(await list("a-admin"))).toHaveLength(1);
  });

  it("replays an Idempotency-Key: the second POST is the first answer, one row", async () => {
    const key = { "idempotency-key": "blocked-ip-key-0001" };
    const first = await add("a-admin", { cidr: "203.0.113.9" }, key);
    const second = await add("a-admin", { cidr: "203.0.113.9" }, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(items(await list("a-admin"))).toHaveLength(1);
  });

  it("answers 422 VALIDATION with the field for a bad address, a range that is too wide or a long note", async () => {
    for (const cidr of ["nope", "0.0.0.0/0", "10.0.0.0/8", "2001:db8::/16", "1.2.3.4/40"]) {
      const res = await add("a-admin", { cidr });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ code: "VALIDATION" });
      expect(res.body).toContain("cidr");
    }
    const note = await add("a-admin", { cidr: "203.0.113.7", note: "x".repeat(201) });
    expect(note.statusCode).toBe(422);
    expect(items(await list("a-admin"))).toEqual([]);
  });

  it("a body that names a tenant (or anything unknown) is 422, never written", async () => {
    const withTenant = await add("a-admin", { cidr: "203.0.113.7", tenantId: SHOP_B });
    expect(withTenant.statusCode).toBe(422);
    expect(withTenant.json()).toMatchObject({ code: "VALIDATION" });
    const empty = await add("a-admin", {});
    expect(empty.statusCode).toBe(422);
    expect(items(await list("b-admin"))).toEqual([]);
    expect(items(await list("a-admin"))).toEqual([]);
  });

  it("is 409 LIMIT_REACHED at the cap, and the cap is per store", async () => {
    for (let index = 0; index < MAX_BLOCKED_IPS_PER_STORE; index += 1) {
      await harness.store.add({
        id: `seed-${String(index)}`,
        tenantId: SHOP_A,
        cidr: `${String(1 + (index >> 8))}.${String(index & 255)}.0.1/32`,
        note: null,
        createdAt: "2026-11-28T00:00:00.000Z",
        createdBy: null,
      });
    }
    const full = await add("a-admin", { cidr: "203.0.113.7" });
    expect(full.statusCode).toBe(409);
    expect(full.json()).toMatchObject({ code: "LIMIT_REACHED" });
    expect((await add("b-admin", { cidr: "203.0.113.7" })).statusCode).toBe(201);
  });

  it("exclude-this-device adds the caller's address as one host: the explicit ip, else the forwarded public hop", async () => {
    const explicit = await exclude("a-admin", { ip: "41.32.7.9" });
    expect(explicit.statusCode).toBe(201);
    expect(explicit.json<{ item: Item }>().item).toMatchObject({
      cidr: "41.32.7.9/32",
      note: "Excluded device",
      createdBy: "staff-a-admin",
    });

    const forwarded = await exclude(
      "a-admin",
      {},
      { "x-forwarded-for": "10.0.0.5, 41.32.8.10, 172.16.0.2" },
    );
    expect(forwarded.statusCode).toBe(201);
    expect(forwarded.json<{ item: Item }>().item.cidr).toBe("41.32.8.10/32");

    // a second click on the same device is a no-op
    expect((await exclude("a-admin", { ip: "41.32.7.9" })).statusCode).toBe(200);
    expect(items(await list("a-admin"))).toHaveLength(2);
  });

  it("exclude-this-device refuses an address that is not the visitor's own (loopback / private / proxy) with 422", async () => {
    // inject() peers as 127.0.0.1: nothing public to exclude
    const bare = await exclude("a-admin");
    expect(bare.statusCode).toBe(422);
    expect(bare.body).toContain("ip");
    const privateIp = await exclude("a-admin", { ip: "192.168.1.20" });
    expect(privateIp.statusCode).toBe(422);
    expect(items(await list("a-admin"))).toEqual([]);
  });

  it("removes an entry; removing it again is 200 removed:false", async () => {
    const created = await add("a-admin", { cidr: "203.0.113.7" });
    const id = created.json<{ item: Item }>().item.id;
    const removed = await remove("a-admin", id);
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ id, removed: true });
    const again = await remove("a-admin", id);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ id, removed: false });
    expect(items(await list("a-admin"))).toEqual([]);
  });

  it("is per store: another store neither sees nor removes this store's entries", async () => {
    const created = await add("a-admin", { cidr: "203.0.113.7" });
    const id = created.json<{ item: Item }>().item.id;
    expect(items(await list("b-admin"))).toEqual([]);
    expect((await remove("b-admin", id)).json()).toEqual({ id, removed: false });
    expect(items(await list("a-admin"))).toHaveLength(1);
    // and the same range can be listed independently in the other store
    expect((await add("b-admin", { cidr: "203.0.113.7" })).statusCode).toBe(201);
  });

  it("the block list matches what the service says is blocked (the collect route reads the same service)", async () => {
    await add("a-admin", { cidr: "203.0.113.0/24" });
    expect(await harness.service.isBlocked(SHOP_A, "203.0.113.200")).toBe(true);
    expect(await harness.service.isBlocked(SHOP_B, "203.0.113.200")).toBe(false);
  });

  it("only an admin may read or write: viewer and operator get 403 on every route", async () => {
    for (const token of ["a-viewer", "a-operator"]) {
      expect((await list(token)).statusCode).toBe(403);
      expect((await add(token, { cidr: "203.0.113.7" })).statusCode).toBe(403);
      expect((await exclude(token, { ip: "41.32.7.9" })).statusCode).toBe(403);
      expect((await remove(token, "x")).statusCode).toBe(403);
    }
    expect(items(await list("a-admin"))).toEqual([]);
  });

  it("no token is 401", async () => {
    const res = await app.inject({ method: "GET", url: `${API}/tracking/blocked-ips` });
    expect(res.statusCode).toBe(401);
  });
});
