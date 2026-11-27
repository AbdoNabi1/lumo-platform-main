import { beforeEach, describe, expect, it } from "vitest";
import { EnvelopeCipher, KeyAliasRegistry } from "../envelope";
import { LocalKeyWrapCipher } from "./index";

beforeEach(() => {
  expect.hasAssertions();
});

describe("LocalKeyWrapCipher (test-only, @platform/secrets/testing)", () => {
  it("round-trips through a real envelope and never carries the plaintext", async () => {
    const aliases = new KeyAliasRegistry();
    aliases.set("test-alias", "kek-1");
    const envelope = new EnvelopeCipher(new LocalKeyWrapCipher(), aliases);

    const sealed = await envelope.seal("hello-plaintext", "test-alias");

    expect(JSON.stringify(sealed)).not.toContain("hello-plaintext");
    expect(await envelope.open(sealed)).toBe("hello-plaintext");
  });

  it("refuses to decrypt under a different key, and refuses malformed ciphertext", async () => {
    const cipher = new LocalKeyWrapCipher();
    const ciphertext = await cipher.encrypt("secret", "key-a");

    await expect(cipher.decrypt(ciphertext, "key-b")).rejects.toThrow();
    await expect(cipher.decrypt("not-three-parts", "key-a")).rejects.toThrow(
      /malformed ciphertext/,
    );
  });

  it("generates random hex tokens of the requested size", async () => {
    const cipher = new LocalKeyWrapCipher();
    const token = await cipher.randomToken(8);

    expect(token).toMatch(/^[0-9a-f]{16}$/);
    expect(await cipher.randomToken()).toMatch(/^[0-9a-f]{48}$/);
  });
});
