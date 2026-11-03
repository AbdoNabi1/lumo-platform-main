import { describe, expect, it } from "vitest";
import { checkUpload } from "./upload-rules";

describe("checkUpload (browser pre-check; the server decides)", () => {
  it.each([
    [{ type: "image/png", size: 1000 }, "favicon", "ok"],
    [{ type: "image/jpeg", size: 1000 }, "favicon", "unsupported"],
    [{ type: "image/png", size: 2 * 1024 * 1024 }, "favicon", "too_large"],
    [{ type: "image/webp", size: 1000 }, "share_image", "unsupported"],
    [{ type: "image/svg+xml", size: 10 }, "logo", "unsupported"],
    [{ type: "image/webp", size: 1000 }, "logo", "ok"],
  ] as const)("%j as %s → %s", (file, purpose, expected) => {
    expect(checkUpload(file, purpose)).toBe(expected);
  });
});
