import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `authConfig` is a module-level `as const` built from `process.env` at import time, so each case
 * has to stub the env and re-import rather than mutate anything. `AUTH_CLIENT_SECRET` is stubbed
 * in every case because `requireProdEnv` throws without it outside dev — unrelated to what is
 * under test here, but it would fail the import.
 */
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("AUTH_CLIENT_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("oryAdminHeaders", () => {
  it("includes the bearer token when ORY_API_KEY is set", async () => {
    vi.stubEnv("ORY_API_KEY", "ory_pat_xyz");
    const { oryAdminHeaders } = await import("./ory-admin");
    expect(oryAdminHeaders()["authorization"]).toBe("Bearer ory_pat_xyz");
  });

  it("merges caller headers with the token", async () => {
    vi.stubEnv("ORY_API_KEY", "ory_pat_xyz");
    const { oryAdminHeaders } = await import("./ory-admin");
    const headers = oryAdminHeaders({ "content-type": "application/json" });
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["authorization"]).toBe("Bearer ory_pat_xyz");
  });

  it("omits the token when ORY_API_KEY is unset (self-hosted Ory)", async () => {
    vi.stubEnv("ORY_API_KEY", "");
    const { oryAdminHeaders } = await import("./ory-admin");
    expect(oryAdminHeaders()["authorization"]).toBeUndefined();
  });

  it("returns caller headers untouched when no key is configured", async () => {
    vi.stubEnv("ORY_API_KEY", "");
    const { oryAdminHeaders } = await import("./ory-admin");
    expect(oryAdminHeaders({ "content-type": "application/json" })).toEqual({
      "content-type": "application/json",
    });
  });

  it("never sends a bare 'Bearer ' for an empty key", async () => {
    vi.stubEnv("ORY_API_KEY", "");
    const { oryAdminHeaders } = await import("./ory-admin");
    expect(Object.values(oryAdminHeaders())).not.toContain("Bearer ");
  });
});
