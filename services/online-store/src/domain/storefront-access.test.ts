import { inspect } from "node:util";
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

  it("bumps the access version once per apply, even when the password changes and it locks together", () => {
    const access = StorefrontAccess.defaults();
    access.apply({ locked: true, newPasswordHash: "h1", message: {}, now });
    expect(access.snapshot().accessVersion).toBe(2);
  });

  it("nextVersion is 1 before the first save and version + 1 after", () => {
    expect(StorefrontAccess.defaults().nextVersion).toBe(1);
    const persisted = StorefrontAccess.reconstitute({
      ...StorefrontAccess.defaults().snapshot(),
      version: 4,
      persisted: true,
    });
    expect(persisted.nextVersion).toBe(5);
  });
});

describe("StorefrontAccess never serialises its hash (spec 1.5, anti-goal)", () => {
  const HASH = "scrypt$secret-hash-value";
  const locked = () => {
    const access = StorefrontAccess.defaults();
    access.apply({ locked: true, newPasswordHash: HASH, message: { ar: "قريبًا" }, now });
    return access;
  };

  it("JSON.stringify of the aggregate has no hash, only whether a password is set", () => {
    const json = JSON.stringify(locked());
    expect(json).not.toContain(HASH);
    expect(json).not.toContain("passwordHash");
    expect(JSON.parse(json)).toMatchObject({ locked: true, passwordSet: true, accessVersion: 2 });
  });

  it("console.log and util.inspect do not print the private state either", () => {
    expect(inspect(locked())).not.toContain(HASH);
    expect(String(locked())).not.toContain(HASH);
  });

  it("reports passwordSet false before any password exists", () => {
    expect(JSON.parse(JSON.stringify(StorefrontAccess.defaults()))).toMatchObject({
      passwordSet: false,
    });
  });

  it("snapshot() still holds the hash: it is for repositories only", () => {
    expect(locked().snapshot().passwordHash).toBe(HASH);
  });
});
