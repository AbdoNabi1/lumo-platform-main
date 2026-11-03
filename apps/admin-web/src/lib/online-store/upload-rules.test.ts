import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkUpload, UPLOAD_RULES } from "./upload-rules";

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

/**
 * Drift guard: `UPLOAD_RULES` restates the server's per-purpose policy by hand (admin-web never
 * imports backend code), so this reads the policy's SOURCE TEXT, the way `route-contract.test.ts`
 * reads the route table, and fails when the two disagree on types or byte caps.
 */
describe("UPLOAD_RULES mirrors services/media IMAGE_POLICIES", () => {
  const MB = 1024 * 1024;
  const source = readFileSync(
    path.resolve(__dirname, "../../../../../services/media/src/application/image-purposes.ts"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  it.each(Object.keys(UPLOAD_RULES) as (keyof typeof UPLOAD_RULES)[])("%s", (purpose) => {
    const block = new RegExp(`\\n  ${purpose}: \\{([\\s\\S]*?)\\n  \\},`).exec(source)?.[1];
    expect(block, `no ${purpose} policy in image-purposes.ts`).toBeDefined();
    const types = (/types: \[([^\]]*)\]/.exec(block ?? "")?.[1] ?? "")
      .split(",")
      .map((t) => t.trim().replace(/"/g, ""))
      .filter((t) => t.length > 0)
      .map((t) => `image/${t}`);
    const bytes = /maxBytes: (?:(\d+) \* MB|(MAX_UPLOAD_BYTES))/.exec(block ?? "");
    expect(bytes, `no maxBytes for ${purpose}`).not.toBeNull();
    const maxBytes = bytes?.[2] !== undefined ? 8 * MB : Number(bytes?.[1]) * MB;
    expect([...UPLOAD_RULES[purpose].types].sort()).toEqual(types.sort());
    expect(UPLOAD_RULES[purpose].maxBytes).toBe(maxBytes);
  });
});
