import { describe, expect, it } from "vitest";
import { ScryptPasswordHasher } from "./scrypt-password-hasher";

// log2N 10 keeps the suite fast; production uses the default (15).
const hasher = new ScryptPasswordHasher({ log2N: 10 });

describe("ScryptPasswordHasher", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hasher.hash("fake-password-1");
    expect(await hasher.verify("fake-password-1", stored)).toBe(true);
    expect(await hasher.verify("fake-password-2", stored)).toBe(false);
  });

  it("salts: the same password hashes differently twice", async () => {
    const a = await hasher.hash("fake-password-1");
    const b = await hasher.hash("fake-password-1");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$10$8$1$")).toBe(true);
  });

  it("never stores the password itself", async () => {
    const stored = await hasher.hash("fake-password-1");
    expect(stored).not.toContain("fake-password-1");
  });

  it("returns false (never throws) for a malformed stored value", async () => {
    for (const bad of [
      "",
      "plain",
      "scrypt$x$8$1$a$b",
      "bcrypt$10$8$1$AAAA$BBBB",
      "scrypt$10$8$1$$",
    ]) {
      expect(await hasher.verify("fake-password-1", bad)).toBe(false);
    }
  });

  it("flags hashes made with other parameters for rehash", async () => {
    const weak = await new ScryptPasswordHasher({ log2N: 10 }).hash("fake-password-1");
    expect(new ScryptPasswordHasher({ log2N: 10 }).needsRehash(weak)).toBe(false);
    expect(new ScryptPasswordHasher({ log2N: 11 }).needsRehash(weak)).toBe(true);
    expect(new ScryptPasswordHasher({ log2N: 10 }).needsRehash("garbage")).toBe(true);
  });
});
