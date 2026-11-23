// @vitest-environment node
/**
 * LOCKED BY OWNER (2026-11-19). Changing any value here requires an explicit owner order.
 * See docs/ui/BRAND_LOCK.md.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

const svg = readFileSync(new URL("./icon.svg", import.meta.url), "utf8");

describe("icon.svg (locked favicon)", () => {
  beforeEach(() => expect.hasAssertions());

  it("is a 64×64 rounded square in the primary terracotta", () => {
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain('rx="14"');
    expect(svg).toContain('fill="#b8451d"');
  });

  it("scales the bento with the locked transform", () => {
    expect(svg).toContain("translate(6 6) scale(.81)");
  });

  it("draws two white pills with the bento geometry", () => {
    expect(svg.match(/fill="#ffffff"/g)).toHaveLength(2);
    expect(svg).toMatch(
      /<rect[^>]*x="30"[^>]*y="10"[^>]*width="26"[^>]*height="18"[^>]*rx="9"[^>]*fill="#ffffff"/,
    );
    expect(svg).toMatch(
      /<rect[^>]*x="8"[^>]*y="36"[^>]*width="26"[^>]*height="18"[^>]*rx="9"[^>]*fill="#ffffff"/,
    );
  });

  it("draws two blush circles with the bento geometry", () => {
    expect(svg.match(/fill="#f9d5c6"/g)).toHaveLength(2);
    expect(svg).toMatch(/<circle[^>]*cx="17"[^>]*cy="19"[^>]*r="9"[^>]*fill="#f9d5c6"/);
    expect(svg).toMatch(/<circle[^>]*cx="47"[^>]*cy="45"[^>]*r="9"[^>]*fill="#f9d5c6"/);
  });
});
