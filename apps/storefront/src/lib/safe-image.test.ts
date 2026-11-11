import { beforeEach, describe, expect, it } from "vitest";
import { safeImageSrc } from "./safe-image";

beforeEach(() => {
  expect.hasAssertions();
});

describe("safeImageSrc", () => {
  it("accepts http(s) addresses and same-site paths", () => {
    expect(safeImageSrc("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(safeImageSrc("/media/a.png")).toBe("/media/a.png");
  });

  it("refuses everything else", () => {
    for (const bad of [
      "",
      " ",
      "javascript:alert(1)",
      "data:image/png;base64,AA",
      "//evil.example/x",
      "/" + String.fromCharCode(92) + "evil",
      "nope",
      null,
      5,
    ]) {
      expect(safeImageSrc(bad)).toBeNull();
    }
  });
});
