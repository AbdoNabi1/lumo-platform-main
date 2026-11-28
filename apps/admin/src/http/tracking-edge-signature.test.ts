import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EDGE_MAX_SKEW_SECONDS,
  signEdgeRequest,
  verifyEdgeRequest,
} from "./tracking-edge-signature";

/** Low-entropy fixtures on purpose (secret scanners): this is a test value, not a credential. */
const SECRET = "edge-secret-for-tests-".padEnd(40, "0");
const NOW_MS = Date.parse("2026-11-27T12:00:00.000Z");
const NOW_S = Math.floor(NOW_MS / 1000);
const BODY = '{"tenantId":"shop-1","event":{"eventName":"page_view"}}';

describe("tracking edge signature (P1-D3)", () => {
  it("signs HMAC-SHA256 over `<timestamp>.<body>` as lowercase hex — a vector the storefront pins too", () => {
    const expected = createHmac("sha256", SECRET).update(`${NOW_S}.${BODY}`).digest("hex");
    expect(signEdgeRequest(SECRET, NOW_S, BODY)).toBe(expected);
    expect(signEdgeRequest(SECRET, NOW_S, BODY)).toMatch(/^[0-9a-f]{64}$/);
    // The same body as bytes signs identically (the transport hands the route a Uint8Array).
    expect(signEdgeRequest(SECRET, NOW_S, new TextEncoder().encode(BODY))).toBe(expected);
  });

  it("accepts a valid signature inside the window", () => {
    const signature = signEdgeRequest(SECRET, NOW_S, BODY);
    expect(
      verifyEdgeRequest({
        secret: SECRET,
        signature,
        timestamp: String(NOW_S),
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a body changed by one byte", () => {
    const signature = signEdgeRequest(SECRET, NOW_S, BODY);
    expect(
      verifyEdgeRequest({
        secret: SECRET,
        signature,
        timestamp: String(NOW_S),
        rawBody: `${BODY} `,
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a signature made with another secret", () => {
    const signature = signEdgeRequest("another-secret-".padEnd(40, "1"), NOW_S, BODY);
    expect(
      verifyEdgeRequest({
        secret: SECRET,
        signature,
        timestamp: String(NOW_S),
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a timestamp that was not the one signed", () => {
    const signature = signEdgeRequest(SECRET, NOW_S, BODY);
    expect(
      verifyEdgeRequest({
        secret: SECRET,
        signature,
        timestamp: String(NOW_S + 1),
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a replay of an old, correctly signed request (more than 5 minutes)", () => {
    const old = NOW_S - EDGE_MAX_SKEW_SECONDS - 1;
    const signature = signEdgeRequest(SECRET, old, BODY);
    expect(
      verifyEdgeRequest({
        secret: SECRET,
        signature,
        timestamp: String(old),
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: false, reason: "skew" });
  });

  it("refuses a timestamp from the future past the same window, and accepts the edge of it", () => {
    const future = NOW_S + EDGE_MAX_SKEW_SECONDS + 1;
    expect(
      verifyEdgeRequest({
        secret: SECRET,
        signature: signEdgeRequest(SECRET, future, BODY),
        timestamp: String(future),
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: false, reason: "skew" });

    const edge = NOW_S - EDGE_MAX_SKEW_SECONDS;
    expect(
      verifyEdgeRequest({
        secret: SECRET,
        signature: signEdgeRequest(SECRET, edge, BODY),
        timestamp: String(edge),
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: true });
  });

  it("names a missing header or a non-numeric timestamp without throwing", () => {
    const base = { secret: SECRET, rawBody: BODY, nowMs: NOW_MS };
    expect(verifyEdgeRequest({ ...base, signature: undefined, timestamp: String(NOW_S) })).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(verifyEdgeRequest({ ...base, signature: "ab", timestamp: undefined })).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(verifyEdgeRequest({ ...base, signature: "ab", timestamp: "yesterday" })).toEqual({
      ok: false,
      reason: "malformed_timestamp",
    });
    expect(verifyEdgeRequest({ ...base, signature: "ab", timestamp: "1e9" })).toEqual({
      ok: false,
      reason: "malformed_timestamp",
    });
  });

  it("refuses a signature that is not 64 hex characters (so the constant-time compare is length-safe)", () => {
    const base = { secret: SECRET, rawBody: BODY, nowMs: NOW_MS, timestamp: String(NOW_S) };
    for (const signature of ["", "zz".repeat(32), "ab", "AB".repeat(32).slice(0, 63)]) {
      expect(verifyEdgeRequest({ ...base, signature })).toEqual({
        ok: false,
        reason: "bad_signature",
      });
    }
  });
});
