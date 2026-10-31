import { describe, expect, it } from "vitest";
import { parsePasswordInput, StorefrontAccess } from "./storefront-access";

const now = new Date("2026-10-27T10:00:00.000Z");

describe("parsePasswordInput", () => {
  it.each([
    [undefined, { kind: "keep" }],
    [null, { kind: "keep" }],
    ["   ", { kind: "keep" }],
    ["abc", { kind: "invalid" }],
    ["x".repeat(101), { kind: "invalid" }],
    ["  ١٢٣٤  ", { kind: "set", password: "١٢٣٤" }],
    ["open sesame", { kind: "set", password: "open sesame" }],
  ])("%j → %j", (raw, expected) => {
    expect(parsePasswordInput(raw)).toEqual(expected);
  });
});

describe("StorefrontAccess", () => {
  it("is unlocked with no password by default, access version 1", () => {
    const access = StorefrontAccess.defaults();
    expect(access.snapshot()).toMatchObject({
      locked: false,
      passwordHash: null,
      accessVersion: 1,
      version: 0,
      persisted: false,
    });
  });

  it("refuses to lock without any password, and changes nothing", () => {
    const access = StorefrontAccess.defaults();
    const result = access.apply({ locked: true, newPasswordHash: null, message: {}, now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/^PASSWORD_REQUIRED:/);
    expect(access.snapshot().locked).toBe(false);
  });

  it("bumps the access version on a password change and on unlocked → locked only", () => {
    const access = StorefrontAccess.defaults();
    access.apply({ locked: false, newPasswordHash: "h1", message: {}, now });
    expect(access.snapshot().accessVersion).toBe(2);
    expect(access.snapshot().passwordUpdatedAt).toEqual(now);
    access.apply({ locked: true, newPasswordHash: null, message: {}, now });
    expect(access.snapshot().accessVersion).toBe(3);
    access.apply({ locked: true, newPasswordHash: null, message: { ar: "قريبًا" }, now });
    expect(access.snapshot().accessVersion).toBe(3);
    access.apply({ locked: false, newPasswordHash: null, message: {}, now });
    expect(access.snapshot().accessVersion).toBe(3);
    access.apply({ locked: true, newPasswordHash: null, message: {}, now });
    expect(access.snapshot().accessVersion).toBe(4);
  });
});
