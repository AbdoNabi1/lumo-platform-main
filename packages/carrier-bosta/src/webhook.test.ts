import { beforeEach, describe, expect, it } from "vitest";
import webhook24 from "./__fixtures__/webhook.state-24.json";
import webhook47 from "./__fixtures__/webhook.state-47.json";
import { bostaWebhookEventId, parseBostaWebhook } from "./webhook";

beforeEach(() => {
  expect.hasAssertions();
});
const bytesOf = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

describe("Bosta webhooks", () => {
  it("parses documented examples and converts tracking numbers", () => {
    const parsed = parseBostaWebhook(bytesOf(webhook24));
    expect(parsed).toEqual({
      trackingNumber: "48089608",
      state: 24,
      type: "SEND",
      timeStamp: 1689252908261,
      numberOfAttempts: 0,
    });
    expect(bostaWebhookEventId(parsed!)).toBe("48089608:24:1689252908261");
    expect(parseBostaWebhook(bytesOf(webhook47))?.exceptionReason).toMatch(/^Postponed/);
  });
  it("drops unknown keys, rejects malformed data, and clips reasons", () => {
    expect(parseBostaWebhook(bytesOf({ ...webhook24, extra: "x" }))).toEqual({
      trackingNumber: "48089608",
      state: 24,
      type: "SEND",
      timeStamp: 1689252908261,
      numberOfAttempts: 0,
    });
    const bad = [
      [1],
      "str",
      { state: 24 },
      { ...webhook24, state: "24" },
      { ...webhook24, trackingNumber: "a b" },
      { ...webhook24, extra: "x".repeat(16_385) },
    ];
    for (const raw of bad) expect(parseBostaWebhook(bytesOf(raw))).toBeNull();
    expect(parseBostaWebhook(new TextEncoder().encode("{not json"))).toBeNull();
    expect(
      parseBostaWebhook(bytesOf({ ...webhook47, exceptionReason: "x".repeat(300) }))
        ?.exceptionReason,
    ).toHaveLength(200);
  });
  it("allows only valid optional fields and has stable missing-timestamp IDs", () => {
    const parsed = parseBostaWebhook(
      bytesOf({
        trackingNumber: "AB-1",
        state: 0,
        type: "x".repeat(41),
        timeStamp: "bad",
        exceptionReason: 3,
        exceptionCode: "3",
        businessReference: 2,
        cod: "1",
        numberOfAttempts: "0",
      }),
    );
    expect(parsed).toEqual({ trackingNumber: "AB-1", state: 0 });
    expect(bostaWebhookEventId(parsed!)).toBe("AB-1:0:none");
    expect(
      parseBostaWebhook(
        bytesOf({
          trackingNumber: "T",
          state: 47,
          exceptionCode: 3,
          businessReference: "order",
          cod: 12.5,
          numberOfAttempts: 2,
        }),
      ),
    ).toEqual({
      trackingNumber: "T",
      state: 47,
      exceptionCode: 3,
      businessReference: "order",
      cod: 12.5,
      numberOfAttempts: 2,
    });
    expect(parseBostaWebhook(bytesOf({ trackingNumber: 1.5, state: 24 }))).toBeNull();
    expect(parseBostaWebhook(bytesOf({ trackingNumber: "T", state: 24.5 }))).toBeNull();
  });
});
