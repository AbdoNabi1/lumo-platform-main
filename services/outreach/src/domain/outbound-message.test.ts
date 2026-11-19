import { describe, expect, it } from "vitest";
import { nextStatus, type OutboundStatus } from "./outbound-message";

describe("nextStatus", () => {
  it.each<[OutboundStatus, OutboundStatus, OutboundStatus]>([
    ["accepted", "delivered", "delivered"],
    ["read", "sent", "read"],
    ["delivered", "failed", "delivered"],
    ["sent", "failed", "failed"],
    ["failed", "delivered", "failed"],
    ["unknown", "sent", "sent"],
    ["suppressed", "sent", "suppressed"],
    ["pending", "accepted", "accepted"],
  ])("(%s, %s) -> %s", (current, incoming, expected) => {
    expect.hasAssertions();
    expect(nextStatus(current, incoming)).toBe(expected);
  });

  it("never moves backwards across the provider ranks", () => {
    expect.hasAssertions();
    const ranked: OutboundStatus[] = ["pending", "accepted", "sent", "delivered", "read"];
    for (let c = 0; c < ranked.length; c++) {
      for (let i = 0; i < ranked.length; i++) {
        expect(nextStatus(ranked[c]!, ranked[i]!)).toBe(ranked[Math.max(c, i)]);
      }
    }
  });

  it("a read-then-failed late failure is ignored", () => {
    expect.hasAssertions();
    expect(nextStatus("read", "failed")).toBe("read");
  });

  it.each<OutboundStatus>(["pending", "accepted", "sent", "unknown"])("%s -> failed", (current) => {
    expect.hasAssertions();
    expect(nextStatus(current, "failed")).toBe("failed");
  });

  it.each<OutboundStatus>([
    "pending",
    "accepted",
    "sent",
    "delivered",
    "read",
    "failed",
    "unknown",
    "suppressed",
  ])("failed and suppressed are terminal against %s", (incoming) => {
    expect.hasAssertions();
    expect(nextStatus("failed", incoming)).toBe("failed");
    expect(nextStatus("suppressed", incoming)).toBe("suppressed");
  });

  it.each<OutboundStatus>(["accepted", "sent", "delivered", "read", "failed"])(
    "unknown moves to the provider status %s",
    (incoming) => {
      expect.hasAssertions();
      expect(nextStatus("unknown", incoming)).toBe(incoming);
    },
  );

  it("a late unknown never overwrites a known provider status", () => {
    expect.hasAssertions();
    for (const current of ["accepted", "sent", "delivered", "read"] as const) {
      expect(nextStatus(current, "unknown")).toBe(current);
    }
    expect(nextStatus("pending", "unknown")).toBe("unknown");
    expect(nextStatus("unknown", "unknown")).toBe("unknown");
    expect(nextStatus("unknown", "pending")).toBe("unknown");
  });

  it("suppressed only applies before anything reached the provider", () => {
    expect.hasAssertions();
    expect(nextStatus("pending", "suppressed")).toBe("suppressed");
    expect(nextStatus("sent", "suppressed")).toBe("sent");
    expect(nextStatus("unknown", "suppressed")).toBe("unknown");
  });
});
