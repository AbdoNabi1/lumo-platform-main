import { describe, expect, it } from "vitest";
import type { AuditTrail, Cache, Clock } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import { KratosSessionAuthenticator } from "./kratos";

/**
 * T10.5 case 5 (cache) for the auth adapters. The session cache lives in the one global Redis
 * keyspace, so what stops tenant A's session context reaching tenant B is that the key is the
 * (unguessable, per-session) token and the tenant travels INSIDE the cached context.
 *
 * The authorization-DECISION cache (`CachedAccessControl`) is deliberately absent from this file:
 * its key is `authz:<principalId>:<permission>` and the `AccessControl` port has no tenant at all,
 * so "A's decision is not served to B" cannot even be expressed against it. That is a finding, not a
 * test — see the T10.5 entry in docs/plans/phase-7/WP-10-multi-tenant-runtime.md and gap G-67.
 */
function sharedKeyspace(): Cache {
  const store = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (store.get(key) as T | undefined) ?? null,
    set: async (key, value) => void store.set(key, JSON.parse(JSON.stringify(value))),
    delete: async (key) => void store.delete(key),
    has: async (key) => store.has(key),
  };
}

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;
const clock: Clock = { now: () => new Date(0) };
const auditTrail = { record: async () => undefined } as unknown as AuditTrail;

describe("KratosSessionAuthenticator cache tenant isolation (T10.5)", () => {
  it("two sessions in one shared keyspace each resolve to their own tenant, from cache too", async () => {
    let whoamiCalls = 0;
    const sessions: Record<string, { id: string; tenant: string }> = {
      "token-a": { id: "user-a", tenant: "tenant-a" },
      "token-b": { id: "user-b", tenant: "tenant-b" },
    };
    const authenticator = new KratosSessionAuthenticator({
      publicUrl: "http://kratos.invalid",
      adminUrl: "http://kratos-admin.invalid",
      cache: sharedKeyspace(),
      auditTrail,
      clock,
      logger,
      fetch: async (_url, init) => {
        whoamiCalls += 1;
        const session = sessions[init?.headers?.["X-Session-Token"] ?? ""];
        if (session === undefined) return { status: 401, json: async () => ({}) };
        return {
          status: 200,
          json: async () => ({
            id: `session-${session.id}`,
            active: true,
            identity: {
              id: session.id,
              metadata_public: { kind: "staff", tenant_id: session.tenant },
            },
          }),
        };
      },
    });

    const firstA = await authenticator.verifyWithClaims("token-a");
    const firstB = await authenticator.verifyWithClaims("token-b");
    const cachedA = await authenticator.verifyWithClaims("token-a");
    const cachedB = await authenticator.verifyWithClaims("token-b");

    expect(whoamiCalls).toBe(2); // control: the second round really came from the cache
    expect(firstA?.claims["tenant_id"]).toBe("tenant-a");
    expect(cachedA?.claims["tenant_id"]).toBe("tenant-a");
    expect(firstB?.claims["tenant_id"]).toBe("tenant-b");
    expect(cachedB?.claims["tenant_id"]).toBe("tenant-b");
    expect(cachedA?.principal.id).not.toBe(cachedB?.principal.id);
    // An unknown token must not be satisfied by anyone else's cached session.
    expect(await authenticator.verifyWithClaims("token-c")).toBeNull();
  });
});
