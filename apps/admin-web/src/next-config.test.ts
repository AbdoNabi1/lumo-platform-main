// @vitest-environment node
import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Plan 2C-3 — product pictures live on the public media bucket, a different origin from the admin. The
 * page's Content-Security-Policy must allow exactly that origin for images (and nothing broader), and
 * server actions must accept an 8 MB picture plus its form overhead.
 */

// Loaded through a computed path on purpose: a static import would pull `next.config.ts` into the
// lint/type project, which only knows it as a default-project file.
const CONFIG_PATH = ["..", "next.config"].join("/");

async function loadConfig(): Promise<NextConfig> {
  vi.resetModules();
  const loaded = (await import(/* @vite-ignore */ CONFIG_PATH)) as { default: NextConfig };
  return loaded.default;
}

async function imgSrc(): Promise<string> {
  const config = await loadConfig();
  const rules = await config.headers!();
  const csp = rules[0]!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
  return csp.split("; ").find((directive) => directive.startsWith("img-src"))!;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin-web next.config (Plan 2C-3)", () => {
  it("allows images only from the app itself and data urls when no media bucket is configured", async () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE_URL", "");
    expect(await imgSrc()).toBe("img-src 'self' data:");
  });

  it("adds the media bucket's ORIGIN to img-src — not its path, not a wildcard", async () => {
    vi.stubEnv(
      "MEDIA_PUBLIC_BASE_URL",
      "https://media.example.test/storage/v1/object/public/media",
    );
    expect(await imgSrc()).toBe("img-src 'self' data: https://media.example.test");
  });

  it("ignores a value that is not a url rather than loosening the policy", async () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE_URL", "not a url");
    expect(await imgSrc()).toBe("img-src 'self' data:");
  });

  it("allows framing the storefront preview (frame-src), never framing the admin itself (Ruling 18)", async () => {
    vi.stubEnv("STOREFRONT_URL", "http://localhost:3000/shop");
    const config = await loadConfig();
    const rules = await config.headers!();
    const csp = rules[0]!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp.split("; ")).toContain(
      "frame-src 'self' https: http://localhost:3000 https://www.facebook.com https://web.facebook.com",
    );
    expect(csp.split("; ")).toContain("frame-ancestors 'none'");
  });

  it("frame-src adds nothing for an invalid storefront address", async () => {
    vi.stubEnv("STOREFRONT_URL", "not a url");
    const config = await loadConfig();
    const rules = await config.headers!();
    const csp = rules[0]!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp.split("; ")).toContain(
      "frame-src 'self' https: https://www.facebook.com https://web.facebook.com",
    );
  });

  it("compiles the shared storefront content package from source", async () => {
    const config = await loadConfig();
    expect(config.transpilePackages).toContain("@platform/storefront-content");
  });

  it("accepts server action bodies up to 10 MB (an 8 MB picture plus the form around it)", async () => {
    const config = await loadConfig();
    expect(config.experimental?.serverActions?.bodySizeLimit).toBe("10mb");
  });
});

async function directives(): Promise<Map<string, string>> {
  const config = await loadConfig();
  const rules = await config.headers!();
  const csp = rules[0]!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
  return new Map(
    csp.split("; ").map((directive) => {
      const [name = "", ...sources] = directive.split(" ");
      return [name, sources.join(" ")] as const;
    }),
  );
}

describe("admin-web next.config — WhatsApp Embedded Signup (Outreach Part 1)", () => {
  it("allows the Facebook SDK script origin in script-src, exactly", async () => {
    expect.hasAssertions();
    const csp = await directives();
    expect(csp.get("script-src")).toBe("'self' 'unsafe-inline' https://connect.facebook.net");
  });

  it("allows the Facebook login origins in frame-src and connect-src, exactly", async () => {
    expect.hasAssertions();
    vi.stubEnv("STOREFRONT_URL", "");
    const csp = await directives();
    expect(csp.get("frame-src")).toBe(
      "'self' https: https://www.facebook.com https://web.facebook.com",
    );
    expect(csp.get("connect-src")).toBe("'self' https://www.facebook.com https://web.facebook.com");
  });

  it("adds no wildcard and no other Facebook origin anywhere in the policy", async () => {
    expect.hasAssertions();
    const config = await loadConfig();
    const rules = await config.headers!();
    const csp = rules[0]!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp).not.toContain("*");
    const facebook = csp.split(/[\s;]+/).filter((source) => source.includes("facebook"));
    expect([...new Set(facebook)].sort()).toEqual([
      "https://connect.facebook.net",
      "https://web.facebook.com",
      "https://www.facebook.com",
    ]);
  });

  it("keeps every existing directive and security header", async () => {
    expect.hasAssertions();
    vi.stubEnv("MEDIA_PUBLIC_BASE_URL", "https://media.example.test/bucket");
    vi.stubEnv("KRATOS_PUBLIC_URL", "https://kratos.example.test/x");
    vi.stubEnv("HYDRA_PUBLIC_URL", "https://hydra.example.test/y");
    const csp = await directives();
    expect(csp.get("default-src")).toBe("'self'");
    expect(csp.get("style-src")).toBe("'self' 'unsafe-inline'");
    expect(csp.get("img-src")).toBe("'self' data: https://media.example.test");
    expect(csp.get("font-src")).toBe("'self' data:");
    expect(csp.get("form-action")).toBe(
      "'self' https://kratos.example.test https://hydra.example.test",
    );
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("base-uri")).toBe("'self'");
    const config = await loadConfig();
    const headers = (await config.headers!())[0]!.headers;
    expect(headers.find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
    expect(headers.map((h) => h.key)).toEqual(
      expect.arrayContaining([
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "Strict-Transport-Security",
      ]),
    );
  });

  it("does not let the admin itself be framed (frame-ancestors stays none)", async () => {
    expect.hasAssertions();
    expect((await directives()).get("frame-ancestors")).toBe("'none'");
  });
});
