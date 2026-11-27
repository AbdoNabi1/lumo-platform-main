/**
 * LOCKED BY OWNER (2026-11-19). Changing any value here requires an explicit owner order.
 * See docs/ui/BRAND_LOCK.md.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BrandMark } from "./brand-mark";

/** The Nusuj 2×2 bento: two circles in the secondary tone, two pills in the primary. */
describe("BrandMark (locked geometry)", () => {
  beforeEach(() => expect.hasAssertions());

  function renderMark(className?: string) {
    const { container } = render(<BrandMark className={className} />);
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("BrandMark did not render an svg");
    return svg;
  }

  it("is a 64×64 decorative svg, size-7 by default", () => {
    const svg = renderMark();
    expect(svg).toHaveAttribute("viewBox", "0 0 64 64");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg.getAttribute("class")).toContain("size-7");
  });

  it("lets a caller override the size", () => {
    expect(renderMark("size-5").getAttribute("class")).toContain("size-5");
  });

  it("draws exactly two circles and two rects", () => {
    const svg = renderMark();
    expect(svg.querySelectorAll("circle")).toHaveLength(2);
    expect(svg.querySelectorAll("rect")).toHaveLength(2);
  });

  it("places the circles at the locked coordinates in the secondary brand tone", () => {
    const circles = Array.from(renderMark().querySelectorAll("circle"));
    expect(
      circles.map((c) => [c.getAttribute("cx"), c.getAttribute("cy"), c.getAttribute("r")]),
    ).toEqual([
      ["17", "19", "9"],
      ["47", "45", "9"],
    ]);
    for (const circle of circles)
      expect(circle.getAttribute("class")).toContain("fill-brand-secondary");
  });

  it("places the pills at the locked coordinates in the primary tone", () => {
    const rects = Array.from(renderMark().querySelectorAll("rect"));
    expect(
      rects.map((r) => ["x", "y", "width", "height", "rx"].map((a) => r.getAttribute(a))),
    ).toEqual([
      ["30", "10", "26", "18", "9"],
      ["8", "36", "26", "18", "9"],
    ]);
    for (const rect of rects) expect(rect.getAttribute("class")).toContain("fill-primary");
  });
});
