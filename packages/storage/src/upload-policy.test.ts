import { describe, expect, it } from "vitest";
import { validateUpload, type UploadPolicy } from "./upload-policy";

const imagePolicy: UploadPolicy = {
  maxSizeBytes: 5 * 1024 * 1024,
  allowedContentTypes: ["image/png", "image/jpeg", "image/webp"],
  allowedExtensions: ["png", "jpg", "jpeg", "webp"],
};

describe("validateUpload", () => {
  it("accepts a compliant candidate", () => {
    const result = validateUpload(imagePolicy, {
      filename: "wagon.png",
      contentType: "image/png",
      sizeBytes: 1024,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects oversize, disallowed type, and disallowed extension with field issues", () => {
    const result = validateUpload(imagePolicy, {
      filename: "payload.exe",
      contentType: "application/x-msdownload",
      sizeBytes: 50 * 1024 * 1024,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.error.fields.map((f) => f.field);
      expect(fields).toEqual(expect.arrayContaining(["sizeBytes", "contentType", "filename"]));
    }
  });

  it("strips content-type parameters before matching", () => {
    const result = validateUpload(imagePolicy, {
      contentType: "image/PNG; charset=binary",
      sizeBytes: 10,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects non-positive sizes", () => {
    expect(validateUpload(imagePolicy, { contentType: "image/png", sizeBytes: 0 }).ok).toBe(false);
  });
});
