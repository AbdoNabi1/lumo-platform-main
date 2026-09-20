import { describe, expect, it } from "vitest";
import type { AccessControl, Cache, Principal } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import { CachedAccessControl, KetoAccessControl } from "./keto";
import { KetoRelationshipClient } from "./keto-relationships";
import type { HttpFetch } from "./kratos";
import { qualify } from "../../../scripts/ops/keto-tenant-tuples.mjs";

/**
 * G-67 (closed) and G-70 (code-complete, migration pending) — tenant scoping of authorization.
 *
 * G-67: the DECISION CACHE and the audit record were tenant-blind. Fixed: the key carries the tenant.
 * G-70: the Keto TUPLE carried no tenant, so a grant was global per principal. The code now writes the
 * tenant-qualified tuple `tenant/<tenantId>/<permission>` and reads it (`objectFor`); the case below
 * was an `it.fails` reproducing the leak and is a plain `it()` now. It proves the CODE. It does not
 * prove the LIVE tuples are migrated — that is the operator runbook, not a test.
 *
 * The control beside it proves the fake Keto and the writer work, so the leak assertion cannot pass
 * on a broken fixture.
 */

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;

const inTenant = (id: string, tenantId: string): Principal => ({
  id,
  kind: "staff",
  roles: [],
  tenantId,
});

function sharedKeyspace(): Cache {
  const store = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (store.get(key) as T | undefined) ?? null,
    set: async (key, value) => void store.set(key, JSON.parse(JSON.stringify(value))),
    delete: async (key) => void store.delete(key),
    has: async (key) => store.has(key),
  };
}

describe("CachedAccessControl key is tenant-scoped (G-67, closed)", () => {
  function counting(): { inner: AccessControl; calls: Principal[] } {
    const calls: Principal[] = [];
    return {
      calls,
      inner: {
        authorize: async (principal) => {
          calls.push(principal);
          return true;
        },
      },
    };
  }

  it("does not serve one tenant's decision to the same principal in another tenant", async () => {
    const { inner, calls } = counting();
    const cached = new CachedAccessControl(inner, sharedKeyspace(), 30);
    await cached.authorize(inTenant("user-1", "tenant-a"), "orders:refund");
    await cached.authorize(inTenant("user-1", "tenant-b"), "orders:refund");
    expect(calls.map((p) => p.tenantId)).toEqual(["tenant-a", "tenant-b"]);
  });

  it("still caches within one tenant (the TTL window is unchanged)", async () => {
    const { inner, calls } = counting();
    const cached = new CachedAccessControl(inner, sharedKeyspace(), 30);
    await cached.authorize(inTenant("user-1", "tenant-a"), "orders:refund");
    await cached.authorize(inTenant("user-1", "tenant-a"), "orders:refund");
    expect(calls).toHaveLength(1);
  });

  it("does not let ids containing ':' collide across (tenant, principal) pairs", async () => {
    // Unencoded, both keys are `authz:a:b:c:orders:refund`.
    const { inner, calls } = counting();
    const cached = new CachedAccessControl(inner, sharedKeyspace(), 30);
    await cached.authorize(inTenant("b:c", "a"), "orders:refund");
    await cached.authorize(inTenant("c", "a:b"), "orders:refund");
    expect(calls).toHaveLength(2);
  });

  it("keeps the anonymous public principal per tenant too", async () => {
    const { inner, calls } = counting();
    const cached = new CachedAccessControl(inner, sharedKeyspace(), 30);
    await cached.authorize(inTenant("public", "tenant-a"), "catalog:read");
    await cached.authorize(inTenant("public", "tenant-b"), "catalog:read");
    expect(calls).toHaveLength(2);
  });
});

/** A Keto that stores tuples exactly as written and answers a check only on an exact match. */
function fakeKeto() {
  const tuples = new Set<string>();
  const key = (p: URLSearchParams) =>
    [p.get("namespace"), p.get("object"), p.get("relation"), p.get("subject_id")].join("|");
  const fetch: HttpFetch = async (url, init) => {
    const target = new URL(url);
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body ?? "{}") as Record<string, string>;
      tuples.add([body.namespace, body.object, body.relation, body.subject_id].join("|"));
      return { status: 201, json: async () => ({}) };
    }
    return { status: 200, json: async () => ({ allowed: tuples.has(key(target.searchParams)) }) };
  };
  return { tuples, fetch };
}

describe("Keto grants are tenant-scoped (G-70, code-complete)", () => {
  async function granted() {
    const keto = fakeKeto();
    // The production write path — the same call `relation-sync.consumer.ts` makes for the
    // tenant-qualified twin of a tuple a tenant-A operator granted.
    await new KetoRelationshipClient({
      readUrl: "http://keto:4466",
      writeUrl: "http://keto:4467",
      fetch: keto.fetch,
      logger,
    }).write({
      namespace: "permissions",
      object: qualify("tenant-a", "orders:refund"),
      relation: "granted",
      subject: "user-1",
    });
    const access = new KetoAccessControl({
      readUrl: "http://keto:4466",
      fetch: keto.fetch,
      logger,
    });
    return { keto, access };
  }

  it("control: a granted principal is allowed and an ungranted one is denied", async () => {
    const { access } = await granted();
    expect(await access.authorize(inTenant("user-1", "tenant-a"), "orders:refund")).toBe(true);
    expect(await access.authorize(inTenant("user-2", "tenant-a"), "orders:refund")).toBe(false);
  });

  it("a grant made for tenant A does not allow the same principal in tenant B", async () => {
    const { access } = await granted();
    expect(await access.authorize(inTenant("user-1", "tenant-b"), "orders:refund")).toBe(false);
  });

  it("a BARE tuple (not yet migrated) allows nobody: reads no longer look at it", async () => {
    const keto = fakeKeto();
    await new KetoRelationshipClient({
      readUrl: "http://keto:4466",
      writeUrl: "http://keto:4467",
      fetch: keto.fetch,
      logger,
    }).write({
      namespace: "permissions",
      object: "orders:refund",
      relation: "granted",
      subject: "user-1",
    });
    const access = new KetoAccessControl({
      readUrl: "http://keto:4466",
      fetch: keto.fetch,
      logger,
    });
    expect(await access.authorize(inTenant("user-1", "tenant-a"), "orders:refund")).toBe(false);
  });

  it("objectFor and the operator scripts' qualify() build the same object", async () => {
    const keto = fakeKeto();
    const seen: string[] = [];
    const spy: HttpFetch = async (url, init) => {
      seen.push(new URL(url).searchParams.get("object") ?? "");
      return keto.fetch(url, init);
    };
    await new KetoAccessControl({
      readUrl: "http://keto:4466",
      fetch: spy,
      logger,
    }).authorize(inTenant("user-1", "tenant-a"), "orders:refund");
    expect(seen).toEqual([qualify("tenant-a", "orders:refund")]);
  });
});
