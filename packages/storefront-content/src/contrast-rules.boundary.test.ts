import { beforeEach, describe, expect, it, vi } from "vitest";

const ratio = vi.hoisted(() => ({ value: 21 }));

vi.mock("@platform/design", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  contrastRatio: () => ratio.value,
}));

import { checkBrandContrast } from "./contrast-rules";
import { DEFAULT_THEME_DOCUMENT } from "./theme-document";

const colors = DEFAULT_THEME_DOCUMENT.brand.colors;

describe("checkBrandContrast at the exact thresholds", () => {
  beforeEach(() => {
    ratio.value = 21;
  });

  it("exactly 3:1 does not block, but warns", () => {
    ratio.value = 3;
    const result = checkBrandContrast(colors);
    expect(result.blocking).toEqual([]);
    expect(result.warnings.map((w) => w.pair)).toEqual([
      "foreground",
      "primaryForeground",
      "accentForeground",
    ]);
  });

  it("just under 3:1 blocks", () => {
    ratio.value = 2.999;
    expect(checkBrandContrast(colors).blocking).toEqual([
      { path: "brand.colors.foreground", code: "CONTRAST_TOO_LOW" },
    ]);
  });

  it("exactly 4.5:1 neither blocks nor warns", () => {
    ratio.value = 4.5;
    expect(checkBrandContrast(colors)).toEqual({ blocking: [], warnings: [] });
  });

  it("just under 4.5:1 warns", () => {
    ratio.value = 4.49;
    expect(checkBrandContrast(colors).warnings).toHaveLength(3);
  });
});
