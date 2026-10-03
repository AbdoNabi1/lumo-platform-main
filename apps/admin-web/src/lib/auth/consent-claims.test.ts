import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConsentClaims, type IdentityLookup } from "./consent-claims";

const identity = (metadata: unknown, email = "owner@example.com") => ({
  id: "id-1",
  traits: { email },
  metadata_public: metadata,
});

describe("resolveConsentClaims", () => {
  it("uses the login context when it carries roles (self-hosted /login set it) and never calls Ory", async () => {
    const lookup = vi.fn<IdentityLookup>();
    const claims = await resolveConsentClaims(
      {
        subject: "id-1",
        context: { kind: "staff", roles: ["operator"], email: "a@example.com" },
      },
      lookup,
    );
    expect(claims).toEqual({ kind: "staff", roles: ["operator"], email: "a@example.com" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("with Ory's hosted login there is no context, so the roles come from the identity's metadata_public", async () => {
    const lookup = vi
      .fn<IdentityLookup>()
      .mockResolvedValue(identity({ kind: "staff", roles: ["admin"] }));
    const claims = await resolveConsentClaims({ subject: "id-1" }, lookup);
    expect(lookup).toHaveBeenCalledWith("id-1");
    expect(claims).toEqual({ kind: "staff", roles: ["admin"], email: "owner@example.com" });
  });

  it("an identity without roles gets none (the middleware then sends it to /forbidden) and kind defaults to staff", async () => {
    const lookup = vi.fn<IdentityLookup>().mockResolvedValue(identity(undefined));
    const claims = await resolveConsentClaims({ subject: "id-1" }, lookup);
    expect(claims.roles).toEqual([]);
    expect(claims.kind).toBe("staff");
  });

  it("keeps a kind other than staff when the identity declares one", async () => {
    const lookup = vi
      .fn<IdentityLookup>()
      .mockResolvedValue(identity({ kind: "partner", roles: ["viewer"] }));
    const claims = await resolveConsentClaims({ subject: "id-1" }, lookup);
    expect(claims.kind).toBe("partner");
  });

  it("drops non-string entries from metadata_public.roles", async () => {
    const lookup = vi
      .fn<IdentityLookup>()
      .mockResolvedValue(identity({ roles: ["admin", 7, null, { x: 1 }] }));
    const claims = await resolveConsentClaims({ subject: "id-1" }, lookup);
    expect(claims.roles).toEqual(["admin"]);
  });

  it("ignores a roles value that is not an array", async () => {
    const lookup = vi.fn<IdentityLookup>().mockResolvedValue(identity({ roles: "admin" }));
    const claims = await resolveConsentClaims({ subject: "id-1" }, lookup);
    expect(claims.roles).toEqual([]);
  });

  it("refuses a consent request that has neither roles in its context nor a subject", async () => {
    await expect(resolveConsentClaims({}, vi.fn<IdentityLookup>())).rejects.toThrow(/subject/i);
  });

  it("propagates a failed identity lookup instead of issuing a token with default claims", async () => {
    const lookup = vi.fn<IdentityLookup>().mockRejectedValue(new Error("Ory 401"));
    await expect(resolveConsentClaims({ subject: "id-1" }, lookup)).rejects.toThrow("Ory 401");
  });
});

describe("fetchIdentity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("AUTH_CLIENT_SECRET", "test-secret");
    vi.stubEnv("ORY_API_KEY", "ory_pat_xyz");
    vi.stubEnv("HYDRA_ADMIN_URL", "https://proj.example");
    vi.stubEnv("KRATOS_ADMIN_URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("GETs /admin/identities/<id> with the project API key, falling back to HYDRA_ADMIN_URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(identity({ roles: ["admin"] })), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchIdentity } = await import("./consent-claims");
    await fetchIdentity("a/b");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proj.example/admin/identities/a%2Fb");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer ory_pat_xyz");
  });

  it("prefers KRATOS_ADMIN_URL when it is set", async () => {
    vi.stubEnv("KRATOS_ADMIN_URL", "https://kratos-admin.example");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchIdentity } = await import("./consent-claims");
    await fetchIdentity("id-1");
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "https://kratos-admin.example/admin/identities/id-1",
    );
  });

  it("throws on a non-2xx answer without echoing the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("secret-detail", { status: 401 })),
    );
    const { fetchIdentity } = await import("./consent-claims");
    const err = await fetchIdentity("id-1").catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("401");
    expect((err as Error).message).not.toContain("secret-detail");
  });
});

describe("consent page wiring", () => {
  // The page is an async Server Component that talks to Hydra, so it is pinned by source the way
  // apps/runtime/src/railway-config.test.ts pins Dockerfiles: it must take its claims from
  // resolveConsentClaims, not from the login context alone (which hosted login never provides).
  const page = readFileSync(join(process.cwd(), "src/app/consent/page.tsx"), "utf8");

  it("takes the token claims from resolveConsentClaims", () => {
    expect(page).toContain("await resolveConsentClaims(info)");
    expect(page).toContain("roles: claims.roles");
  });

  it("no longer reads roles straight off the login context", () => {
    expect(page).not.toContain("info.context?.roles");
  });
});
