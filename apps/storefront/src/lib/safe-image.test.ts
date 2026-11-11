import { beforeEach, describe, expect, it } from "vitest";
import { safeImageSrc } from "./safe-image";

const C = String.fromCharCode;

beforeEach(() => {
  expect.hasAssertions();
});

describe("safeImageSrc", () => {
  it("accepts https addresses and same-site paths", () => {
    expect(safeImageSrc("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(safeImageSrc("/media/a.png")).toBe("/media/a.png");
  });

  it("refuses control characters, spaces and backslashes anywhere (browsers strip them)", () => {
    const bad = [
      "/" + C(9) + "/evil.example/x.png",
      "/" + C(10) + "/evil.example/x.png",
      "/" + C(13) + "/evil.example/x.png",
      "/a b.png",
      "/a" + C(92) + "b.png",
      "https://cdn.example/a" + C(9) + ".png",
      "/../../x.png",
    ];
    for (const url of bad) expect(safeImageSrc(url)).toBeNull();
  });

  it("refuses http and credentialed urls: only https without userinfo", () => {
    for (const bad of [
      "http://cdn.example/a.png",
      "HTTP://cdn.example/a.png",
      "https://user:pass@cdn.example/a.png",
      "https://user@cdn.example/a.png",
      "https://:pass@cdn.example/a.png",
    ]) {
      expect(safeImageSrc(bad), bad).toBeNull();
    }
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
