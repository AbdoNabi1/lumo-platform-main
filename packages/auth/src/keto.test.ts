import { describe, expect, it } from "vitest";
import type { Cache } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import { CachedAccessControl, KetoAccessControl } from "./keto";
import type { HttpFetch } from "./kratos";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

const principal = { id: "principal:a", kind: "staff" as const, roles: [], tenantId: "tenant-a" };

describe("KetoAccessControl — subject_id convention (default, self-hosted Keto)", () => {
  it("checks with subject_id and no subject_set params, honors allowed=true", async () => {
    // `authorize` catches anything thrown inside its own `fetch` call, so an `expect()` failure
    // in the stub would surface as a misleading "expected true, got false" instead of the real
    // mismatch — capture the URL and assert on it after the call returns instead.
    let calledUrl: string | undefined;
    const fetchImpl: HttpFetch = async (url) => {
      calledUrl = String(url);
      return { status: 200, json: async () => ({ allowed: true }) };
    };
    const ac = new KetoAccessControl({
      readUrl: "http://keto:4466",
      fetch: fetchImpl,
      logger: silent,
    });
    expect(await ac.authorize(principal, "products:read")).toBe(true);
    const parsed = new URL(calledUrl!);
    expect(parsed.searchParams.get("namespace")).toBe("permissions");
    expect(parsed.searchParams.get("object")).toBe("tenant/tenant-a/products:read");
    expect(parsed.searchParams.get("relation")).toBe("granted");
    expect(parsed.searchParams.get("subject_id")).toBe("principal:a");
    expect(parsed.searchParams.has("subject_set.namespace")).toBe(false);
  });

  it("honors allowed=false", async () => {
    const ac = new KetoAccessControl({
      readUrl: "http://keto:4466",
      fetch: async () => ({ status: 200, json: async () => ({ allowed: false }) }),
      logger: silent,
    });
    expect(await ac.authorize(principal, "products:read")).toBe(false);
  });

  it("FAILS CLOSED on non-200 and on transport error", async () => {
    expect(
      await new KetoAccessControl({
        readUrl: "http://keto:4466",
        fetch: async () => ({ status: 500, json: async () => ({}) }),
        logger: silent,
      }).authorize(principal, "products:read"),
    ).toBe(false);
    expect(
      await new KetoAccessControl({
        readUrl: "http://keto:4466",
        fetch: async () => {
          throw new Error("ECONNREFUSED");
        },
        logger: silent,
      }).authorize(principal, "products:read"),
    ).toBe(false);
  });
});

describe("KetoAccessControl — subject_set convention (Ory Network)", () => {
  it("checks with subject_set.namespace/object/relation instead of subject_id", async () => {
    let calledUrl: string | undefined;
    const fetchImpl: HttpFetch = async (url) => {
      calledUrl = String(url);
      return { status: 200, json: async () => ({ allowed: true }) };
    };
    const ac = new KetoAccessControl({
      readUrl: "http://keto:4466",
      fetch: fetchImpl,
      subjectConvention: "subject_set",
      logger: silent,
    });
    expect(await ac.authorize(principal, "products:read")).toBe(true);
    const parsed = new URL(calledUrl!);
    expect(parsed.searchParams.get("namespace")).toBe("permissions");
    expect(parsed.searchParams.get("object")).toBe("tenant/tenant-a/products:read");
    expect(parsed.searchParams.get("relation")).toBe("granted");
    expect(parsed.searchParams.has("subject_id")).toBe(false);
    expect(parsed.searchParams.get("subject_set.namespace")).toBe("User");
    expect(parsed.searchParams.get("subject_set.object")).toBe("principal:a");
    expect(parsed.searchParams.get("subject_set.relation")).toBe("");
  });

  it("honors a custom subjectSetNamespace", async () => {
    let calledUrl: string | undefined;
    const fetchImpl: HttpFetch = async (url) => {
      calledUrl = String(url);
      return { status: 200, json: async () => ({ allowed: true }) };
    };
    const ac = new KetoAccessControl({
      readUrl: "http://keto:4466",
      fetch: fetchImpl,
      subjectConvention: "subject_set",
      subjectSetNamespace: "Principal",
      logger: silent,
    });
    expect(await ac.authorize(principal, "products:read")).toBe(true);
    expect(new URL(calledUrl!).searchParams.get("subject_set.namespace")).toBe("Principal");
  });

  it("still fails closed on non-200 and transport error", async () => {
    expect(
      await new KetoAccessControl({
        readUrl: "http://keto:4466",
        fetch: async () => ({ status: 403, json: async () => ({ allowed: false }) }),
        subjectConvention: "subject_set",
        logger: silent,
      }).authorize(principal, "products:read"),
    ).toBe(false);
  });
});

describe("CachedAccessControl", () => {
  it("caches a decision and does not re-check within the TTL", async () => {
    let calls = 0;
    const inner = {
      authorize: async () => {
        calls += 1;
        return true;
      },
    };
    const store = new Map<string, boolean>();
    const cache: Cache = {
      get: async <T>(key: string) => (store.has(key) ? (store.get(key) as unknown as T) : null),
      set: async (key: string, value: unknown) => {
        store.set(key, value as boolean);
      },
      delete: async (key: string) => {
        store.delete(key);
      },
      has: async (key: string) => store.has(key),
    };
    const cached = new CachedAccessControl(inner, cache);
    expect(await cached.authorize(principal, "products:read")).toBe(true);
    expect(await cached.authorize(principal, "products:read")).toBe(true);
    expect(calls).toBe(1);
  });

  it("caches a false decision just as durably as a true one", async () => {
    let calls = 0;
    const inner = {
      authorize: async () => {
        calls += 1;
        return false;
      },
    };
    const store = new Map<string, boolean>();
    const cache: Cache = {
      get: async <T>(key: string) => (store.has(key) ? (store.get(key) as unknown as T) : null),
      set: async (key: string, value: unknown) => {
        store.set(key, value as boolean);
      },
      delete: async (key: string) => {
        store.delete(key);
      },
      has: async (key: string) => store.has(key),
    };
    const cached = new CachedAccessControl(inner, cache);
    expect(await cached.authorize(principal, "products:read")).toBe(false);
    expect(await cached.authorize(principal, "products:read")).toBe(false);
    expect(calls).toBe(1);
  });

  it("degrades to the inner decision point on a cache outage, without throwing", async () => {
    const inner = { authorize: async () => true };
    const cache: Cache = {
      get: async () => {
        throw new Error("ECONNREFUSED");
      },
      set: async () => {
        throw new Error("ECONNREFUSED");
      },
      delete: async () => undefined,
      has: async () => false,
    };
    const cached = new CachedAccessControl(inner, cache);
    expect(await cached.authorize(principal, "products:read")).toBe(true);
  });
});
