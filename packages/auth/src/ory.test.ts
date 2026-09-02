import { describe, expect, it } from "vitest";
import type { AuditEvent, AuditTrail, Cache, Clock, Principal } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import { KratosIdentityService, KratosSessionAuthenticator, type HttpFetch } from "./kratos";
import { CachedAccessControl, KetoAccessControl } from "./keto";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};
const clock: Clock = { now: () => new Date("2026-07-05T00:00:00.000Z") };
const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"] };

function fakeCache(): Cache & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: async <T>(k: string) => (store.get(k) as T | undefined) ?? null,
    set: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
    has: async (k) => store.has(k),
  };
}

function fakeAudit(): AuditTrail & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return { events, record: async (e) => void events.push(e) };
}

/** Ory CONTRACT tests: the adapter's expectations of the REST API, runnable without Docker. */
describe("KratosSessionAuthenticator", () => {
  const session = {
    id: "sess-1",
    active: true,
    identity: {
      id: "cust-9",
      metadata_public: { kind: "customer", roles: [], tenant_id: "t-1" },
      traits: { email: "a@b.co" },
    },
  };

  function kratos(fetchImpl: HttpFetch, cache = fakeCache()) {
    return new KratosSessionAuthenticator({
      publicUrl: "http://kratos:4433",
      adminUrl: "http://kratos:4434",
      fetch: fetchImpl,
      cache,
      auditTrail: fakeAudit(),
      clock,
      logger: silent,
    });
  }

  it("maps an active whoami session to a principal + tenant claim, and caches it", async () => {
    let calls = 0;
    const auth = kratos(async (url, init) => {
      calls += 1;
      expect(url).toBe("http://kratos:4433/sessions/whoami");
      expect(init?.headers?.["X-Session-Token"]).toBe("tok-1");
      return { status: 200, json: async () => session };
    });
    const first = await auth.verifyWithClaims("tok-1");
    const second = await auth.verifyWithClaims("tok-1");
    expect(first?.principal.id).toBe("cust-9");
    expect(first?.claims["tenant_id"]).toBe("t-1");
    expect(second?.principal.id).toBe("cust-9");
    expect(calls).toBe(1); // second hit served from cache
  });

  it("returns null for 401 and for inactive sessions", async () => {
    expect(
      await kratos(async () => ({ status: 401, json: async () => ({}) })).verify("bad"),
    ).toBeNull();
    expect(
      await kratos(async () => ({
        status: 200,
        json: async () => ({ ...session, active: false }),
      })).verify("t"),
    ).toBeNull();
  });
});

describe("KratosIdentityService", () => {
  it("revokes sessions via the admin API and audits the action", async () => {
    const audit = fakeAudit();
    const service = new KratosIdentityService({
      publicUrl: "http://kratos:4433",
      adminUrl: "http://kratos:4434",
      fetch: async (url, init) => {
        expect(url).toBe("http://kratos:4434/admin/identities/cust-9/sessions");
        expect(init?.method).toBe("DELETE");
        return { status: 204, json: async () => ({}) };
      },
      cache: fakeCache(),
      auditTrail: audit,
      clock,
      logger: silent,
    });
    expect(await service.revokeSessions("cust-9", staff)).toBe(true);
    expect(audit.events[0]).toMatchObject({
      permission: "identity:revoke_sessions",
      decision: "allow",
      principalId: "staff-1",
    });
  });
});

describe("KetoAccessControl", () => {
  it("checks the relation tuple and honors allowed=true/false", async () => {
    const keto = new KetoAccessControl({
      readUrl: "http://keto:4466",
      fetch: async (url) => {
        expect(url).toContain("namespace=permissions");
        expect(url).toContain(encodeURIComponent("orders:refund"));
        expect(url).toContain("subject_id=staff-1");
        return { status: 200, json: async () => ({ allowed: true }) };
      },
      logger: silent,
    });
    expect(await keto.authorize(staff, "orders:refund")).toBe(true);
  });

  it("FAILS CLOSED on non-200 and on transport failure", async () => {
    const down = new KetoAccessControl({
      readUrl: "http://keto:4466",
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
      logger: silent,
    });
    expect(await down.authorize(staff, "orders:refund")).toBe(false);
    const err500 = new KetoAccessControl({
      readUrl: "http://keto:4466",
      fetch: async () => ({ status: 500, json: async () => ({}) }),
      logger: silent,
    });
    expect(await err500.authorize(staff, "orders:refund")).toBe(false);
  });

  it("CachedAccessControl caches decisions for the TTL window (revocation latency)", async () => {
    let calls = 0;
    const inner = { authorize: async () => ((calls += 1), true) };
    const cached = new CachedAccessControl(inner, fakeCache(), 30);
    expect(await cached.authorize(staff, "orders:refund")).toBe(true);
    expect(await cached.authorize(staff, "orders:refund")).toBe(true);
    expect(calls).toBe(1);
  });
});
