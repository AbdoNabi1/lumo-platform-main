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

  it("accepts server action bodies up to 10 MB (an 8 MB picture plus the form around it)", async () => {
    const config = await loadConfig();
    expect(config.experimental?.serverActions?.bodySizeLimit).toBe("10mb");
  });
});
