import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicOrigin } from "./public-origin";

/**
 * Behind Railway's proxy a Next standalone server reports `request.nextUrl.origin` as the address it
 * bound to (measured: `https://localhost:8080` with a correct Host and X-Forwarded-* on the request),
 * so every `redirect_uri` and redirect built from it pointed at an address the browser cannot reach.
 */
function req(headers: Record<string, string>, internalOrigin = "https://localhost:8080") {
  return { headers: new Headers(headers), nextUrl: { origin: internalOrigin } };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicOrigin", () => {
  it("builds the origin from the forwarded host and proto, not the internal bind address", () => {
    expect(
      publicOrigin(req({ "x-forwarded-host": "admin.example.com", "x-forwarded-proto": "https" })),
    ).toBe("https://admin.example.com");
  });

  it("prefers x-forwarded-host over host", () => {
    expect(
      publicOrigin(
        req({
          host: "internal:8080",
          "x-forwarded-host": "admin.example.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://admin.example.com");
  });

  it("falls back to host when there is no x-forwarded-host", () => {
    expect(publicOrigin(req({ host: "admin.example.com", "x-forwarded-proto": "https" }))).toBe(
      "https://admin.example.com",
    );
  });

  it("uses only the first value of a comma-separated forwarded header", () => {
    expect(
      publicOrigin(
        req({
          "x-forwarded-host": "admin.example.com, proxy.internal",
          "x-forwarded-proto": "https, http",
        }),
      ),
    ).toBe("https://admin.example.com");
  });

  it("keeps a port that is part of the public host", () => {
    expect(publicOrigin(req({ host: "localhost:3100", "x-forwarded-proto": "http" }))).toBe(
      "http://localhost:3100",
    );
  });

  it("defaults to https for a non-localhost host with no forwarded proto", () => {
    expect(publicOrigin(req({ host: "admin.example.com" }))).toBe("https://admin.example.com");
  });

  it("defaults to http for localhost with no forwarded proto", () => {
    expect(publicOrigin(req({ host: "localhost:3100" }))).toBe("http://localhost:3100");
  });

  it("ignores a forwarded proto that is neither http nor https", () => {
    expect(
      publicOrigin(req({ host: "admin.example.com", "x-forwarded-proto": "javascript" })),
    ).toBe("https://admin.example.com");
  });

  it("falls back to nextUrl.origin when the host header is not a plain host[:port]", () => {
    expect(publicOrigin(req({ host: "evil.example/../x" }))).toBe("https://localhost:8080");
    expect(publicOrigin(req({ host: "a@evil.example" }))).toBe("https://localhost:8080");
  });

  it("falls back to nextUrl.origin when no host header exists", () => {
    expect(publicOrigin(req({}))).toBe("https://localhost:8080");
  });

  it("ADMIN_WEB_ORIGIN wins over every header, trailing slash removed", () => {
    vi.stubEnv("ADMIN_WEB_ORIGIN", "https://admin.pinned.example/");
    expect(
      publicOrigin(req({ "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" })),
    ).toBe("https://admin.pinned.example");
  });

  it("ignores a blank ADMIN_WEB_ORIGIN", () => {
    vi.stubEnv("ADMIN_WEB_ORIGIN", "");
    expect(publicOrigin(req({ host: "admin.example.com" }))).toBe("https://admin.example.com");
  });
});

describe("publicOrigin wiring", () => {
  // These entrypoints cannot run here without a Hydra, so they are pinned by source: each one that
  // builds a redirect or the OAuth2 redirect_uri must use publicOrigin, never nextUrl.origin.
  for (const file of ["middleware.ts", "app/auth/callback/route.ts", "app/logout/route.ts"]) {
    it(`${file} uses publicOrigin and not nextUrl.origin`, () => {
      const source = readFileSync(join(process.cwd(), "src", file), "utf8");
      expect(source).toContain("publicOrigin(request)");
      expect(source).not.toMatch(/nextUrl.origin/);
      expect(source).not.toMatch(/, origin } = request.nextUrl/);
    });
  }
});
