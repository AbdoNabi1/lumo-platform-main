import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaSignature } from "./meta-webhook-signature";

describe("verifyMetaSignature", () => {
  it("verifies exact raw body and rejects malformed or altered signatures", () => {
    expect.hasAssertions();
    const body = Buffer.from('{"hello":"world"}');
    const digest = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyMetaSignature(body, `sha256=${digest}`, "secret")).toBe(true);
    expect(verifyMetaSignature(body, `sha256=${digest.toUpperCase()}`, "secret")).toBe(true);
    expect(verifyMetaSignature(Buffer.from("changed"), `sha256=${digest}`, "secret")).toBe(false);
    expect(verifyMetaSignature(body, undefined, "secret")).toBe(false);
    expect(verifyMetaSignature(body, `sha1=${digest}`, "secret")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=abcd", "secret")).toBe(false);
    expect(verifyMetaSignature(body, `sha256=${"g".repeat(64)}`, "secret")).toBe(false);
    expect(verifyMetaSignature(body, `sha256=${digest}00`, "secret")).toBe(false);
  });
});
