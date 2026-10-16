import { describe, expect, it } from "vitest";
import { Hostname } from "./hostname";

function value(raw: string): string {
  const result = Hostname.create(raw);
  if (!result.ok) throw new Error(`expected valid: ${raw}`);
  return result.value.value;
}

describe("Hostname", () => {
  it("lowercases, trims and drops a trailing dot", () => {
    expect(value("  Shop.Example.COM. ")).toBe("shop.example.com");
  });

  it("accepts punycode labels (Arabic domains arrive already IDNA-encoded)", () => {
    expect(value("xn--mgbh0fb.xn--wgbh1c")).toBe("xn--mgbh0fb.xn--wgbh1c");
  });

  it.each([
    ["", "empty"],
    ["localhost", "single label"],
    ["shop.example.com:8080", "port"],
    ["https://shop.example.com", "scheme"],
    ["shop.example.com/path", "path"],
    ["-bad.example.com", "leading hyphen"],
    ["bad-.example.com", "trailing hyphen"],
    ["sh_op.example.com", "underscore"],
    [`${"a".repeat(64)}.example.com`, "label over 63"],
    ["متجر.مصر", "raw unicode"],
  ])("rejects %s (%s)", (raw) => {
    expect(Hostname.create(raw).ok).toBe(false);
  });
});
