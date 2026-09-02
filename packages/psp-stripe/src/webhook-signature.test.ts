import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "./webhook-signature";

const SECRET = "whsec_test_secret";

function sign(payload: string, timestamp: number, secret = SECRET): string {
  const hmac = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

describe("verifyStripeSignature (C2-2 Task 3)", () => {
  it("accepts a correctly signed payload within the tolerance window", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const nowMs = 1_700_000_000_000;
    const header = sign(payload, Math.floor(nowMs / 1000));

    expect(
      verifyStripeSignature({
        payload: new TextEncoder().encode(payload),
        signatureHeader: header,
        secret: SECRET,
        now: () => nowMs,
      }),
    ).toBe(true);
  });

  it("rejects a signature computed with the wrong secret (tampered/forged webhook)", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const nowMs = 1_700_000_000_000;
    const header = sign(payload, Math.floor(nowMs / 1000), "whsec_wrong_secret");

    expect(
      verifyStripeSignature({
        payload: new TextEncoder().encode(payload),
        signatureHeader: header,
        secret: SECRET,
        now: () => nowMs,
      }),
    ).toBe(false);
  });

  it("rejects when the payload was mutated after signing (integrity check)", () => {
    const nowMs = 1_700_000_000_000;
    const header = sign(JSON.stringify({ id: "evt_1" }), Math.floor(nowMs / 1000));

    expect(
      verifyStripeSignature({
        payload: new TextEncoder().encode(JSON.stringify({ id: "evt_1_TAMPERED" })),
        signatureHeader: header,
        secret: SECRET,
        now: () => nowMs,
      }),
    ).toBe(false);
  });

  it("rejects a timestamp outside the tolerance window (replay protection)", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const signedAtMs = 1_700_000_000_000;
    const header = sign(payload, Math.floor(signedAtMs / 1000));
    const sixMinutesLaterMs = signedAtMs + 6 * 60 * 1000; // default tolerance is 300s = 5min

    expect(
      verifyStripeSignature({
        payload: new TextEncoder().encode(payload),
        signatureHeader: header,
        secret: SECRET,
        now: () => sixMinutesLaterMs,
      }),
    ).toBe(false);
  });

  it("accepts a replayed-but-still-fresh signature exactly at the tolerance boundary", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const signedAtMs = 1_700_000_000_000;
    const header = sign(payload, Math.floor(signedAtMs / 1000));
    const withinToleranceMs = signedAtMs + 299 * 1000;

    expect(
      verifyStripeSignature({
        payload: new TextEncoder().encode(payload),
        signatureHeader: header,
        secret: SECRET,
        now: () => withinToleranceMs,
      }),
    ).toBe(true);
  });

  it("rejects a malformed header (missing v1)", () => {
    expect(
      verifyStripeSignature({
        payload: new TextEncoder().encode("{}"),
        signatureHeader: "t=1700000000",
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a malformed header (missing t)", () => {
    expect(
      verifyStripeSignature({
        payload: new TextEncoder().encode("{}"),
        signatureHeader: "v1=deadbeef",
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects an empty header", () => {
    expect(
      verifyStripeSignature({
        payload: new TextEncoder().encode("{}"),
        signatureHeader: "",
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("matches ANY v1 entry during a secret-rotation window (multiple v1= pairs)", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const nowMs = 1_700_000_000_000;
    const ts = Math.floor(nowMs / 1000);
    const oldSig = createHmac("sha256", "whsec_old").update(`${ts}.${payload}`).digest("hex");
    const newSig = createHmac("sha256", SECRET).update(`${ts}.${payload}`).digest("hex");

    expect(
      verifyStripeSignature({
        payload: new TextEncoder().encode(payload),
        signatureHeader: `t=${ts},v1=${oldSig},v1=${newSig}`,
        secret: SECRET,
        now: () => nowMs,
      }),
    ).toBe(true);
  });

  it("never throws on a garbage-length signature value (would crash timingSafeEqual otherwise)", () => {
    const nowMs = 1_700_000_000_000;
    expect(() =>
      verifyStripeSignature({
        payload: new TextEncoder().encode("{}"),
        signatureHeader: `t=${Math.floor(nowMs / 1000)},v1=short`,
        secret: SECRET,
        now: () => nowMs,
      }),
    ).not.toThrow();
  });
});
