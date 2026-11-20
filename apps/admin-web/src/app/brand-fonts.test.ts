// @vitest-environment node
/**
 * LOCKED BY OWNER (2026-11-19). Changing any value here requires an explicit owner order.
 * See docs/ui/BRAND_LOCK.md.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");

describe("admin-web brand fonts (locked)", () => {
  beforeEach(() => expect.hasAssertions());

  it("binds the three font slots to the Nusuj families", () => {
    expect(css).toContain('--font-latin: "Plus Jakarta Sans";');
    expect(css).toContain('--font-arabic-family: "Zain";');
    expect(css).toContain('--font-display-family: "Baloo Bhaijaan 2";');
  });

  it("sets page titles in the display font (family only)", () => {
    expect(css).toMatch(/h1\s*\{\s*font-family:\s*var\(--font-display\);\s*\}/);
  });

  it("loads the self-hosted font files", () => {
    expect(layout).toContain('"@fontsource/plus-jakarta-sans/400.css"');
    expect(layout).toContain('"@fontsource/zain/400.css"');
    expect(layout).toContain('"@fontsource/baloo-bhaijaan-2/600.css"');
  });
});
