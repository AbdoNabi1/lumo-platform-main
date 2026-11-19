// @vitest-environment node
/**
 * LOCKED BY OWNER (2026-11-19). Changing any value here requires an explicit owner order.
 * See docs/ui/BRAND_LOCK.md.
 *
 * Buttons are Nusuj pills in the dashboard (`rounded-button` = 9999px), but a merchant's saved
 * corner setting (square / rounded / pill) must keep deciding how storefront buttons look. The
 * storefront therefore re-maps `--radius-button` to the corner scale's `xl` step, which is exactly
 * what buttons used before the pill change. These assertions are the regression evidence.
 */
import { readFileSync } from "node:fs";
import {
  brandToCssVars,
  DEFAULT_THEME_DOCUMENT,
  readBrandStyle,
} from "@platform/storefront-content";
import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => expect.hasAssertions());

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

function themeInlineBlock(source: string): string {
  const start = source.indexOf("@theme inline");
  expect(start).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

const base = readBrandStyle(DEFAULT_THEME_DOCUMENT.brand);
const varsFor = (corners: "square" | "rounded" | "pill") => brandToCssVars({ ...base, corners });

describe("storefront button corners", () => {
  it("maps --radius-button to the merchant's xl corner step, pill when unbranded", () => {
    expect(themeInlineBlock(cssNoComments)).toContain(
      "--radius-button: var(--shop-radius-xl, 9999px);",
    );
  });

  it("a square shop resolves the button radius to 0px", () => {
    expect(varsFor("square")["--shop-radius-xl"]).toBe("0px");
  });

  it("a rounded shop keeps the 16px buttons it had before the pill change", () => {
    expect(varsFor("rounded")["--shop-radius-xl"]).toBe("16px");
  });

  it("a pill shop resolves the button radius to 24px", () => {
    expect(varsFor("pill")["--shop-radius-xl"]).toBe("24px");
  });
});
