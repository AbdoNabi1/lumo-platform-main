import { afterEach, describe, expect, it, vi } from "vitest";
import { CryptoIdGenerator } from "./crypto-id-generator";

describe("CryptoIdGenerator", () => {
  const generator = new CryptoIdGenerator();

  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates an RFC 9562 v7 UUID", () => {
    expect(generator.generate()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("generates unique values", () => {
    expect(generator.generate()).not.toBe(generator.generate());
  });

  it("is time-ordered: later ids sort lexicographically after earlier ids", () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const earlier = generator.generate();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
    const later = generator.generate();

    // The 48-bit timestamp occupies the first 12 hex digits (ignoring hyphens) and is the
    // most-significant part of the id, so a later timestamp always sorts after an earlier one.
    const timestampPrefix = (id: string): string => id.replace(/-/g, "").slice(0, 12);
    expect(timestampPrefix(later) > timestampPrefix(earlier)).toBe(true);
    expect(later > earlier).toBe(true);
  });
});
